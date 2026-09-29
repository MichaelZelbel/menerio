// @vitest-environment node
//
// Loads the real edge function into a sandbox (same technique as
// merge-contacts/__tests__/handler.test.ts). The database, the credit helpers
// and the model are stand-ins; the JSON reader is the real one.
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { transformSync } from "esbuild";
import { describe, expect, it, vi } from "vitest";
import * as router from "../../_shared/llm-router.ts";

const source = readFileSync("supabase/functions/slack-capture/index.ts", "utf8");
const code = transformSync(source, { loader: "ts", format: "cjs" }).code;

function setup(modelReply: string) {
  let handler!: (request: Request) => Promise<Response>;
  const inserts: Record<string, unknown>[] = [];
  const db = {
    auth: { getUser: vi.fn(async () => ({ data: { user: { id: "u" } }, error: null })) },
    from: () => ({
      insert(row: Record<string, unknown>) {
        inserts.push(row);
        return { select: () => ({ single: async () => ({ data: { id: "note-1" }, error: null }) }) };
      },
    }),
  };
  const runChat = vi.fn(async () => ({ content: modelReply, credits: null }));
  const credits = {
    checkBalance: vi.fn(async () => ({ allowed: true, remaining_tokens: 100000, remaining_credits: 10 })),
    getEmbeddingWithCredits: vi.fn(async () => ({ embedding: [0.1], credits: null })),
  };
  const require = (spec: string) => {
    if (spec.includes("supabase-js")) return { createClient: () => db };
    if (spec.includes("llm-credits")) return credits;
    if (spec.includes("llm-router")) return { ...router, runChat };
    if (spec.includes("llm-defaults")) return { INGEST_THOUGHT_METADATA_PROMPT: "p" };
    throw new Error(`unexpected import in slack-capture: ${spec}`);
  };
  runInNewContext(code, {
    require, Request, Response, console,
    Deno: { env: { get: (k: string) => k }, serve: (fn: typeof handler) => { handler = fn; } },
  });
  const call = (body: string) =>
    handler(new Request("https://example.test/slack-capture", { method: "POST", headers: { Authorization: "Bearer jwt" }, body }));
  return { call, inserts, runChat };
}

describe("slack-capture", () => {
  it("saves the text when the model answers null (used to throw and answer 500)", async () => {
    const x = setup("null");
    const res = await x.call('{"text":"a thought"}');
    expect(res.status).toBe(200);
    expect(x.inserts[0]).toMatchObject({ user_id: "u", content: "a thought", tags: ["uncategorized"] });
  });

  it("sends the metadata call at most 24,000 characters and stores the whole text", async () => {
    const x = setup('{"topics":["a"]}');
    await x.call(JSON.stringify({ text: "z".repeat(30_000) }));
    expect((x.runChat.mock.calls[0][0] as any).messages[0].content).toHaveLength(24_000);
    expect(x.inserts[0].content).toHaveLength(30_000);
  });

  it("answers 400 to a body that is not JSON", async () => {
    const x = setup("{}");
    expect((await x.call("nope")).status).toBe(400);
    expect((await x.call('{"text":7}')).status).toBe(400);
    expect(x.inserts).toHaveLength(0);
  });
});
