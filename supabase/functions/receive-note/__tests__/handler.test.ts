// @vitest-environment node
//
// Loads the real edge function into a sandbox (same technique as
// merge-contacts/__tests__/handler.test.ts). The database is a stand-in; the
// key hash and folder normalisation are the real shared modules.
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { transformSync } from "esbuild";
import { describe, expect, it, vi } from "vitest";
import * as sha256 from "../../_shared/sha256.ts";
import * as noteCreateTools from "../../_shared/note-create-tools.ts";

const source = readFileSync("supabase/functions/receive-note/index.ts", "utf8");
const code = transformSync(source, { loader: "ts", format: "cjs" }).code;

const APP = { id: "app-1", user_id: "u", app_name: "querino", is_active: true, permissions: null, connection_status: "active" };

function setup(keyLookup: { data: unknown; error: unknown }) {
  let handler!: (request: Request) => Promise<Response>;
  const inserts: Record<string, unknown>[] = [];
  const db = {
    from(table: string) {
      const q: any = {
        select: () => q,
        eq: () => q,
        order: () => q,
        limit: () => q,
        update: () => q,
        then: (ok: any, bad: any) => Promise.resolve({ error: null }).then(ok, bad),
        single: async () => (keyLookup.data ? keyLookup : { data: null, error: keyLookup.error ?? { code: "PGRST116" } }),
        maybeSingle: async () => (table === "connected_apps" ? keyLookup : { data: null, error: null }),
        insert(row: Record<string, unknown>) {
          inserts.push(row);
          return { select: () => ({ single: async () => ({ data: { id: "note-1" }, error: null }) }) };
        },
      };
      return q;
    },
  };
  const fetch = vi.fn(async () => new Response("{}", { status: 202 }));
  const require = (spec: string) => {
    if (spec.includes("supabase-js")) return { createClient: () => db };
    if (spec.includes("sha256")) return sha256;
    if (spec.includes("note-create-tools")) return noteCreateTools;
    throw new Error(`unexpected import in receive-note: ${spec}`);
  };
  runInNewContext(code, {
    require, Request, Response, console, fetch,
    Deno: { env: { get: (k: string) => k }, serve: (fn: typeof handler) => { handler = fn; } },
  });
  const call = (body: string) =>
    handler(new Request("https://example.test/receive-note", { method: "POST", headers: { "x-api-key": "k" }, body }));
  return { call, inserts };
}

const note = JSON.stringify({ source_id: "s1", title: "T", body: "B" });

describe("receive-note", () => {
  it("answers 503, not 401, when the API key cannot be looked up", async () => {
    const x = setup({ data: null, error: { code: "57014", message: "statement timeout" } });
    expect((await x.call(note)).status).toBe(503);
    expect(x.inserts).toHaveLength(0);
  });

  it("answers 401 for an unknown key", async () => {
    expect((await setup({ data: null, error: null }).call(note)).status).toBe(401);
  });

  it("answers 400 to a body that is not a JSON object", async () => {
    const x = setup({ data: APP, error: null });
    expect((await x.call("not json")).status).toBe(400);
    expect((await x.call("null")).status).toBe(400);
    expect(x.inserts).toHaveLength(0);
  });

  it("creates the note for a working key", async () => {
    const x = setup({ data: APP, error: null });
    expect((await x.call(note)).status).toBe(201);
    expect(x.inserts[0]).toMatchObject({ user_id: "u", source_app: "querino", source_id: "s1", folder_path: "Querino" });
  });
});
