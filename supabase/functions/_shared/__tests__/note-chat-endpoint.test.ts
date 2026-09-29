import { describe, expect, it, vi } from "vitest";
import { fakeDb, loadEndpoint, postJson } from "./edge-harness";

function setup(note: Record<string, unknown>, loopError?: Error, script: { name: string; args: Record<string, unknown> }[] = []) {
  const db = fakeDb((q) => {
    if (q.table === "notes") return { data: note };
    if (q.table === "media_analysis") return { data: [{ storage_path: "user-a/scan.pdf", media_type: "pdf", page_number: 1, original_filename: "scan.pdf", extracted_text: "Scanned secret", description: null, topics: [] }] };
    return { data: [] };
  });
  const outputs: string[] = [];
  const runAgentLoop = vi.fn(async (p: any) => {
    if (loopError) throw loopError;
    for (const call of script) outputs.push(await p.executeTool(call.name, call.args));
    return { reply: "ok", toolResults: [], credits: null };
  });
  const json = (status: number) => () => new Response("{}", { status });
  const handler = loadEndpoint("supabase/functions/note-chat/index.ts", {
    "https://esm.sh/@supabase/supabase-js@2": { createClient: () => db.client },
    "../_shared/llm-credits.ts": {
      checkBalance: async () => ({ allowed: true }),
      openRouterWithCredits: vi.fn(),
      insufficientCreditsResponse: json(402),
      balanceUnavailableResponse: json(503),
      repeatBlockedResponse: json(429),
    },
    "../_shared/llm-router.ts": {
      resolveSystemPrompt: async (_db: unknown, _site: string, fallback: string, vars?: Record<string, string>) => `${fallback}${vars?.noteContext ?? ""}`,
      resolveConfig: async () => ({ effective: { model: "fixture-model", max_tokens: 100 } }),
    },
    "../_shared/llm-defaults.ts": { NOTE_CHAT_NOTE_MODE_PROMPT: "NOTE MODE", NOTE_CHAT_GENERAL_MODE_PROMPT: "GENERAL", NOTE_CHAT_SUMMARIZE_PROMPT: "SUM" },
    "../_shared/user-profile.ts": { getUserProfile: async () => ({}), formatUserProfileDigest: () => "" },
    "../_shared/awareness.ts": { buildAwarenessContext: () => "" },
    "../_shared/web-search.ts": { webSearchTool: {}, runWebSearch: vi.fn() },
    "../_shared/mcp-client.ts": { loadUserMcpTools: async () => null },
    "../_shared/agent-loop.ts": { runAgentLoop },
    "../_shared/read-tools.ts": { READ_TOOL_SCHEMAS: [], READ_TOOL_NAMES: [], CLAIMS_CONTRACT: "", loadPersonProfile: vi.fn(), executeReadTool: vi.fn() },
    "../_shared/note-edit-tools.ts": { NOTE_EDIT_TOOL_SCHEMAS: [], NOTE_EDIT_TOOL_NAMES: [], createNoteEditSession: () => ({ didWrite: false }), executeNoteEditTool: vi.fn() },
    "../_shared/note-create-tools.ts": { NOTE_CREATE_TOOL_SCHEMAS: [], NOTE_CREATE_TOOL_NAMES: [], NOTE_CREATE_CONTRACT: "", createNoteCreateSession: () => ({ created: [], foldersCreated: [] }), executeNoteCreateTool: vi.fn() },
    "../_shared/read-url-tool.ts": { readUrlTool: {}, createUrlReadSession: () => ({}), runReadUrl: vi.fn() },
  }, { SUPABASE_URL: "https://fixture.invalid", SUPABASE_SERVICE_ROLE_KEY: "fixture-service", OPENROUTER_API_KEY: "fixture-key" });
  return { db, handler, runAgentLoop, outputs };
}

const ask = { note_id: "11111111-1111-4111-8111-111111111111", messages: [{ role: "user", content: "summarise this" }] };

describe("note-chat on an open note", () => {
  it("refuses a note hidden from AI before anything reaches the model", async () => {
    const { db, handler, runAgentLoop } = setup({ id: ask.note_id, title: "Diagnosis", content: "Private medical text", tags: [], metadata: {}, ai_visibility: "hidden" });
    const res = await handler(postJson("https://fixture.invalid/note-chat", ask));
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe("NOTE_HIDDEN_FROM_AI");
    expect(runAgentLoop).not.toHaveBeenCalled();
    expect(db.on("media_analysis")).toHaveLength(0);
  });

  it("still chats about a visible note, scoped to the caller", async () => {
    const { db, handler, runAgentLoop } = setup({ id: ask.note_id, title: "Plan", content: "Visible text", tags: [], metadata: {}, ai_visibility: "visible" });
    const res = await handler(postJson("https://fixture.invalid/note-chat", ask));
    expect(res.status).toBe(200);
    expect(runAgentLoop).toHaveBeenCalledTimes(1);
    expect((runAgentLoop.mock.calls[0] as any)[0].systemPrompt).toContain("Visible text");
    expect(db.on("notes")[0].has("eq", "user_id", "user-a")).toBe(true);
    expect(db.on("media_analysis")[0].has("eq", "user_id", "user-a")).toBe(true);
  });
});

describe("note-chat credit refusals", () => {
  it.each([["INSUFFICIENT_CREDITS", 402], ["BALANCE_UNAVAILABLE", 503], ["REPEAT_CALL_BLOCKED", 429]])("answers %s with %i, not 500", async (code, status) => {
    const { handler } = setup({ id: ask.note_id, title: "Plan", content: "Visible text", tags: [], metadata: {}, ai_visibility: "visible" }, new Error(code));
    const res = await handler(postJson("https://fixture.invalid/note-chat", ask));
    expect(res.status).toBe(status);
  });
});

describe("note-chat update_note_metadata", () => {
  it("writes only the documented keys, never the fields the app owns", async () => {
    const note = { id: ask.note_id, title: "Plan", content: "Visible text", tags: [], metadata: { source_url: "https://real.example", matched_people: [{ id: "c1" }] }, ai_visibility: "visible" };
    const { db, handler, outputs } = setup(note, undefined, [
      { name: "update_note_metadata", args: { metadata: { summary: "Short", source_url: "javascript:alert(1)", matched_people: [], is_quick_capture: true } } },
      { name: "update_note_metadata", args: { metadata: { source: "evil" } } },
    ]);
    const res = await handler(postJson("https://fixture.invalid/note-chat", ask));
    expect(res.status).toBe(200);
    const first = JSON.parse(outputs[0]);
    expect(first.updated_fields).toEqual(["summary"]);
    expect(first.ignored_keys).toEqual(["source_url", "matched_people", "is_quick_capture"]);
    expect(JSON.parse(outputs[1]).error).toBe("no supported metadata keys");
    const updates = db.on("notes").filter((q) => q.has("update"));
    expect(updates).toHaveLength(1);
    const written = updates[0].ops.find((op) => op[0] === "update")![1] as { metadata: Record<string, unknown> };
    expect(written.metadata).toEqual({ source_url: "https://real.example", matched_people: [{ id: "c1" }], summary: "Short" });
    expect(updates[0].has("eq", "user_id", "user-a")).toBe(true);
  });
});
