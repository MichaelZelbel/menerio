// @vitest-environment node
//
// Loads the real edge function into a sandbox (same technique as
// receive-note/__tests__/handler.test.ts). The database and Telegram are
// stand-ins.
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { transformSync } from "esbuild";
import { describe, expect, it, vi } from "vitest";

const source = readFileSync("supabase/functions/telegram-capture/index.ts", "utf8");
const code = transformSync(source, { loader: "ts", format: "cjs" }).code;

const SECRET = "0123456789abcdef0123456789abcdef";
const CONN = {
  id: "conn-1", user_id: "u", bot_token: "bot-token", webhook_secret: SECRET,
  is_active: true, is_paired: true, telegram_chat_id: 42, pairing_code: null,
};

function setup(conn: Record<string, unknown> | null = CONN) {
  let handler!: (request: Request) => Promise<Response>;
  const lookups: unknown[] = [];
  const inserts: Record<string, unknown>[] = [];
  const db = {
    auth: { getUser: async () => ({ data: { user: { id: "u" } }, error: null }) },
    from() {
      const filters: Record<string, unknown> = {};
      const q: any = {
        select: () => q,
        eq: (k: string, v: unknown) => { filters[k] = v; return q; },
        contains: () => q,
        limit: () => q,
        then: (ok: any, bad: any) => Promise.resolve({ data: [], error: null }).then(ok, bad),
        single: async () => {
          if ("webhook_secret" in filters) lookups.push(filters.webhook_secret);
          const hit = conn && (!("webhook_secret" in filters) || filters.webhook_secret === conn.webhook_secret);
          return hit ? { data: conn, error: null } : { data: null, error: { code: "PGRST116" } };
        },
        insert(row: Record<string, unknown>) {
          inserts.push(row);
          return { select: () => ({ single: async () => ({ data: { id: "note-1" }, error: null }) }) };
        },
      };
      return q;
    },
  };
  const fetch = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));
  const require = (spec: string) => {
    if (spec.includes("supabase-js")) return { createClient: () => db };
    throw new Error(`unexpected import in telegram-capture: ${spec}`);
  };
  runInNewContext(code, {
    require, Request, Response, URL, console, fetch, AbortSignal, JSON,
    Deno: { env: { get: (k: string) => (k === "SUPABASE_URL" ? "https://proj.supabase.co" : k) }, serve: (fn: typeof handler) => { handler = fn; } },
  });
  return { handler, lookups, inserts, fetch };
}

const update = JSON.stringify({ update_id: 7, message: { chat: { id: 42 }, from: { is_bot: false }, text: "a thought" } });

describe("telegram-capture webhook secret", () => {
  it("accepts the secret in Telegram's secret-token header", async () => {
    const x = setup();
    const res = await x.handler(new Request("https://proj.supabase.co/functions/v1/telegram-capture", {
      method: "POST", headers: { "X-Telegram-Bot-Api-Secret-Token": SECRET }, body: update,
    }));
    expect(res.status).toBe(200);
    expect(x.lookups).toEqual([SECRET]);
    expect(x.inserts).toHaveLength(1);
  });

  it("still accepts a webhook registered with the secret in the URL", async () => {
    const x = setup();
    const res = await x.handler(new Request(`https://proj.supabase.co/functions/v1/telegram-capture?secret=${SECRET}`, {
      method: "POST", body: update,
    }));
    expect(res.status).toBe(200);
    expect(x.inserts).toHaveLength(1);
  });

  it("refuses a delivery with no secret at all", async () => {
    const x = setup();
    const res = await x.handler(new Request("https://proj.supabase.co/functions/v1/telegram-capture", { method: "POST", body: update }));
    expect(res.status).toBe(401);
    expect(x.inserts).toHaveLength(0);
  });

  it("captures nothing for a wrong secret", async () => {
    const x = setup();
    await x.handler(new Request("https://proj.supabase.co/functions/v1/telegram-capture", {
      method: "POST", headers: { "X-Telegram-Bot-Api-Secret-Token": "wrong" }, body: update,
    }));
    expect(x.inserts).toHaveLength(0);
  });

  it("set-webhook registers the secret as secret_token, not in the URL", async () => {
    const x = setup();
    const res = await x.handler(new Request("https://proj.supabase.co/functions/v1/telegram-capture?action=set-webhook", {
      method: "POST", headers: { Authorization: "Bearer session" }, body: "{}",
    }));
    expect(res.status).toBe(200);
    const [url, init] = x.fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.telegram.org/botbot-token/setWebhook");
    const body = JSON.parse(String(init.body));
    expect(body.url).toBe("https://proj.supabase.co/functions/v1/telegram-capture");
    expect(body.url).not.toContain(SECRET);
    expect(body.secret_token).toBe(SECRET);
  });

  it("set-webhook keeps the URL form for a secret Telegram would refuse", async () => {
    const x = setup({ ...CONN, webhook_secret: "has spaces!" });
    await x.handler(new Request("https://proj.supabase.co/functions/v1/telegram-capture?action=set-webhook", {
      method: "POST", headers: { Authorization: "Bearer session" }, body: "{}",
    }));
    const body = JSON.parse(String((x.fetch.mock.calls[0] as unknown as [string, RequestInit])[1].body));
    expect(body.secret_token).toBeUndefined();
    expect(body.url).toBe("https://proj.supabase.co/functions/v1/telegram-capture?secret=has%20spaces!");
  });
});
