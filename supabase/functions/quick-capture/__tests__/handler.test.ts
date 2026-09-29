// @vitest-environment node
//
// Loads the real edge function into a sandbox (same technique as
// merge-contacts/__tests__/handler.test.ts). The database, the credit helpers
// and the model are stand-ins; the JSON reader, the prompt rules and the key
// hash are the real shared modules.
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { transformSync } from "esbuild";
import { describe, expect, it, vi } from "vitest";
import * as router from "../../_shared/llm-router.ts";
import * as sha256 from "../../_shared/sha256.ts";

const source = readFileSync("supabase/functions/quick-capture/index.ts", "utf8");
const code = transformSync(source, { loader: "ts", format: "cjs" }).code;

type Opts = {
  keyLookup?: { data: unknown; error: unknown };
  modelReply?: string;
};

function setup(opts: Opts = {}) {
  let handler!: (request: Request) => Promise<Response>;
  const inserts: Record<string, unknown>[] = [];
  const updates: Record<string, unknown>[] = [];
  const db = {
    auth: { getUser: vi.fn(async () => ({ data: { user: { id: "web-user" } }, error: null })) },
    from(table: string) {
      if (table === "connected_apps") {
        const q: any = {
          select: () => q,
          eq: () => q,
          single: async () => opts.keyLookup ?? { data: null, error: { code: "PGRST116" } },
          maybeSingle: async () => opts.keyLookup ?? { data: null, error: null },
        };
        return q;
      }
      if (table === "notes") {
        return {
          insert(row: Record<string, unknown>) {
            inserts.push(row);
            return { select: () => ({ single: async () => ({ data: { id: "note-1" }, error: null }) }) };
          },
          update(payload: Record<string, unknown>) {
            updates.push(payload);
            return { eq: async () => ({ error: null }) };
          },
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
  };
  const runChat = vi.fn(async () => ({
    content: opts.modelReply ?? '{"title":"Tomatoes","type":"idea","topics":["garden"]}',
    credits: { remaining_tokens: 5000, remaining_credits: 5 },
  }));
  const credits = {
    checkBalance: vi.fn(async () => ({ allowed: true, remaining_tokens: 100000, remaining_credits: 10 })),
    getEmbeddingWithCredits: vi.fn(async () => ({ embedding: [0.1], credits: null })),
    insufficientCreditsResponse: () => new Response("{}", { status: 402 }),
  };
  const require = (spec: string) => {
    if (spec.includes("supabase-js")) return { createClient: () => db };
    if (spec.includes("sha256")) return sha256;
    if (spec.includes("llm-credits")) return credits;
    if (spec.includes("llm-router")) return { ...router, runChat };
    if (spec.includes("llm-defaults")) return { QUICK_CAPTURE_METADATA_PROMPT: "p", metadataFieldContract: () => "contract" };
    throw new Error(`unexpected import in quick-capture: ${spec}`);
  };
  runInNewContext(code, {
    require, Request, Response, console,
    Deno: { env: { get: (k: string) => k }, serve: (fn: typeof handler) => { handler = fn; } },
  });
  const call = (body: string, headers: Record<string, string> = { Authorization: "Bearer jwt" }) =>
    handler(new Request("https://example.test/quick-capture", { method: "POST", headers, body }));
  return { call, inserts, updates, runChat };
}

describe("quick-capture", () => {
  it("answers 503, not 401, when the API key cannot be looked up", async () => {
    const x = setup({ keyLookup: { data: null, error: { code: "57014", message: "statement timeout" } } });
    const res = await x.call('{"content":"hi"}', { "x-api-key": "k" });
    expect(res.status).toBe(503);
    expect(x.inserts).toHaveLength(0);
  });

  it("still answers 401 for an unknown or paused key", async () => {
    expect((await setup().call('{"content":"hi"}', { "x-api-key": "k" })).status).toBe(401);
    const paused = setup({ keyLookup: { data: { user_id: "u", app_name: "querino", is_active: false }, error: null } });
    expect((await paused.call('{"content":"hi"}', { "x-api-key": "k" })).status).toBe(401);
  });

  it("captures with a working API key", async () => {
    const x = setup({ keyLookup: { data: { user_id: "u", app_name: "querino", is_active: true }, error: null } });
    const res = await x.call('{"content":"hi"}', { "x-api-key": "k" });
    expect(res.status).toBe(201);
    expect(x.inserts[0]).toMatchObject({ user_id: "u", metadata: { source: "querino" } });
  });

  it("answers 400 to a body that is not JSON or content that is not text", async () => {
    const x = setup();
    expect((await x.call("not json")).status).toBe(400);
    expect((await x.call('{"content":42}')).status).toBe(400);
    expect(x.inserts).toHaveLength(0);
  });

  it("stores the whole text but sends the metadata call at most 24,000 characters", async () => {
    const x = setup();
    const res = await x.call(JSON.stringify({ content: "y".repeat(100_000) }));
    expect(res.status).toBe(201);
    expect(x.inserts[0].content).toHaveLength(100_000);
    const args = x.runChat.mock.calls[0][0] as any;
    expect(args.messages[0].content).toHaveLength(24_000);
    expect(args.systemSuffix).toContain("SOURCE IS DATA");
  });

  it("reads a fenced JSON reply instead of dropping the metadata", async () => {
    const x = setup({ modelReply: '```json\n{"title":"Taxes","type":"task"}\n```' });
    const body = await (await x.call('{"content":"file taxes"}')).json();
    expect(body.title).toBe("Taxes");
    expect(x.updates[0]).toMatchObject({ title: "Taxes", metadata: { type: "task", is_quick_capture: true } });
  });
});
