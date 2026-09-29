// @vitest-environment node
//
// Loads the real edge function into a sandbox (same technique as
// merge-contacts/__tests__/handler.test.ts) and drives it with Slack-signed
// events. The database, the credit helpers and the model are stand-ins; the
// JSON reader and the prompt rules are the real ones from llm-router.
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { createHmac } from "node:crypto";
import { transformSync } from "esbuild";
import { describe, expect, it, vi } from "vitest";
import * as router from "../../_shared/llm-router.ts";

const source = readFileSync("supabase/functions/ingest-thought/index.ts", "utf8");
const code = transformSync(source, { loader: "ts", format: "cjs" }).code;

const ENV: Record<string, string> = {
  SUPABASE_URL: "https://project.test",
  SUPABASE_SERVICE_ROLE_KEY: "service",
  OPENROUTER_API_KEY: "or",
  SLACK_BOT_TOKEN: "xoxb",
  SLACK_CAPTURE_CHANNEL: "C-CAPTURE",
  BRAIN_OWNER_USER_ID: "owner",
  SLACK_SIGNING_SECRET: "signing-secret",
};

type Opts = {
  existingTs?: string[];
  insertError?: boolean;
  modelReply?: string;
  runChatThrows?: boolean;
};

function setup(opts: Opts = {}) {
  let handler!: (request: Request) => Promise<Response>;
  const order: string[] = [];
  const inserts: Record<string, unknown>[] = [];
  const updates: Record<string, unknown>[] = [];
  const replies: string[] = [];
  const db = {
    from(table: string) {
      if (table !== "notes") throw new Error(`unexpected table ${table}`);
      const filters: Array<[string, unknown]> = [];
      const q: any = {
        select: () => q,
        eq: (c: string, v: unknown) => (filters.push([c, v]), q),
        limit: () => q,
        then: (ok: any, bad: any) => {
          const ts = filters.find(([c]) => c === "metadata->>slack_ts")?.[1];
          const hit = (opts.existingTs ?? []).includes(String(ts));
          return Promise.resolve({ data: hit ? [{ id: "old" }] : [], error: null }).then(ok, bad);
        },
        insert(row: Record<string, unknown>) {
          order.push("insert");
          inserts.push(row);
          return {
            select: () => ({
              single: async () => opts.insertError
                ? { data: null, error: { message: "db down" } }
                : { data: { id: "note-1" }, error: null },
            }),
          };
        },
        update(payload: Record<string, unknown>) {
          order.push("update");
          updates.push(payload);
          return { eq: async () => ({ error: null }) };
        },
      };
      return q;
    },
  };
  const runChat = vi.fn(async (args: any) => {
    order.push("runChat");
    if (opts.runChatThrows) throw new Error("OpenRouter chat/completions failed: 503");
    return { content: opts.modelReply ?? '{"type":"idea","topics":["garden"]}', credits: null };
  });
  const credits = {
    checkBalance: vi.fn(async () => ({ allowed: true, remaining_tokens: 100000, remaining_credits: 10 })),
    getEmbeddingWithCredits: vi.fn(async () => ({ embedding: [0.1, 0.2], credits: null })),
  };
  const fetch = vi.fn(async (url: string, init?: RequestInit) => {
    if (String(url).includes("chat.postMessage")) replies.push(JSON.parse(String(init?.body)).text);
    return new Response('{"ok":true}', { status: 200 });
  });
  const require = (spec: string) => {
    if (spec.includes("supabase-js")) return { createClient: () => db };
    if (spec.includes("llm-credits")) return credits;
    if (spec.includes("llm-router")) return { ...router, runChat };
    if (spec.includes("llm-defaults")) return { INGEST_THOUGHT_METADATA_PROMPT: "extract metadata" };
    throw new Error(`unexpected import in ingest-thought: ${spec}`);
  };
  runInNewContext(code, {
    require, Request, Response, TextEncoder, console, fetch, crypto: globalThis.crypto,
    Deno: { env: { get: (k: string) => ENV[k] }, serve: (fn: typeof handler) => { handler = fn; } },
  });

  const call = (text: string, headers: Record<string, string> = {}, ts = "1727600000.000100", secret = ENV.SLACK_SIGNING_SECRET) => {
    const body = JSON.stringify({
      type: "event_callback",
      event: { type: "message", channel: "C-CAPTURE", user: "U1", text, ts },
    });
    const stamp = String(Math.floor(Date.now() / 1000));
    const sig = "v0=" + createHmac("sha256", secret).update(`v0:${stamp}:${body}`).digest("hex");
    return handler(new Request("https://example.test/ingest-thought", {
      method: "POST",
      headers: { "X-Slack-Request-Timestamp": stamp, "X-Slack-Signature": sig, ...headers },
      body,
    }));
  };
  return { call, order, inserts, updates, replies, runChat };
}

describe("ingest-thought (Slack events)", () => {
  it("saves the message before any AI call and enriches it afterwards", async () => {
    const x = setup();
    const res = await x.call("Plant tomatoes in May");
    expect(res.status).toBe(200);
    expect(x.order).toEqual(["insert", "runChat", "update"]);
    expect(x.inserts[0]).toMatchObject({ user_id: "owner", content: "Plant tomatoes in May", metadata: { source: "slack", slack_ts: "1727600000.000100" } });
    expect(x.updates[0]).toMatchObject({ tags: ["garden"], embedding: [0.1, 0.2], metadata: { type: "idea", source: "slack" } });
    expect(x.replies).toEqual(["Captured as *idea* - garden"]);
  });

  it("keeps the thought when the model answers null (used to throw after the AI and answer 500)", async () => {
    const x = setup({ modelReply: "null" });
    const res = await x.call("a thought");
    expect(res.status).toBe(200);
    expect(x.inserts).toHaveLength(1);
    expect(x.updates[0]).toMatchObject({ tags: ["uncategorized"], metadata: { type: "observation" } });
  });

  it("reads a fenced JSON reply", async () => {
    const x = setup({ modelReply: '```json\n{"type":"task","topics":["tax"]}\n```' });
    await x.call("file taxes");
    expect(x.updates[0]).toMatchObject({ tags: ["tax"], metadata: { type: "task" } });
  });

  it("keeps the saved note when the model fails", async () => {
    const x = setup({ runChatThrows: true });
    const res = await x.call("a thought");
    expect(res.status).toBe(200);
    expect(x.inserts).toHaveLength(1);
    expect(x.replies[0]).toContain("Captured");
  });

  it("sends the metadata call at most 24,000 characters", async () => {
    const x = setup();
    await x.call("x".repeat(40_000));
    expect(x.runChat.mock.calls[0][0].messages[0].content).toHaveLength(24_000);
    expect(x.inserts[0].content).toHaveLength(40_000);
  });

  it("captures a retry whose first delivery failed, but not one that timed out", async () => {
    const failed = setup();
    expect((await failed.call("t", { "X-Slack-Retry-Num": "1", "X-Slack-Retry-Reason": "http_error" })).status).toBe(200);
    expect(failed.inserts).toHaveLength(1);

    const timedOut = setup();
    expect((await timedOut.call("t", { "X-Slack-Retry-Num": "1", "X-Slack-Retry-Reason": "http_timeout" })).status).toBe(200);
    expect(timedOut.inserts).toHaveLength(0);
  });

  it("never saves a message twice", async () => {
    const x = setup({ existingTs: ["1727600000.000100"] });
    expect((await x.call("t", { "X-Slack-Retry-Num": "2", "X-Slack-Retry-Reason": "http_error" })).status).toBe(200);
    expect(x.inserts).toHaveLength(0);
  });

  it("lets Slack retry a failed save and only tells the channel when no retry is left", async () => {
    const first = setup({ insertError: true });
    expect((await first.call("t")).status).toBe(500);
    expect(first.replies).toEqual([]);
    expect(first.runChat).not.toHaveBeenCalled();

    const last = setup({ insertError: true });
    expect((await last.call("t", { "X-Slack-Retry-Num": "3", "X-Slack-Retry-Reason": "http_error" })).status).toBe(500);
    expect(last.replies).toEqual(["❌ Could not save this note. Please send it again."]);
  });

  it("refuses a request that Slack did not sign", async () => {
    const x = setup();
    expect((await x.call("t", {}, "1", "wrong-secret")).status).toBe(401);
    expect(x.inserts).toHaveLength(0);
  });
});
