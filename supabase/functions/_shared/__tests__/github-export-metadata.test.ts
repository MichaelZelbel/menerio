// @vitest-environment node
import { describe, expect, it } from "vitest";
import { build } from "esbuild";
import vm from "node:vm";
import { webcrypto } from "node:crypto";

/**
 * github-sync-export, run as deployed (the real index.ts, bundled), against a
 * synthetic database and a synthetic GitHub. The point under test: a note
 * whose metadata holds characters above U+00FF (an en dash, a curly
 * apostrophe, an emoji) exports, and the pull side's `JSON.parse(atob(...))`
 * reads the metadata back unchanged. `btoa` used to throw on such a note.
 */

type Row = Record<string, unknown>;

async function exportNote(note: Row) {
  const puts: { url: string; body: Row }[] = [];
  const client = {
    auth: { getClaims: async () => ({ data: { claims: { sub: "user-a" } }, error: null }) },
    from(table: string) {
      const rows: Row[] =
        table === "github_connections" ? [{ user_id: "user-a", sync_enabled: true, github_token: "gh", repo_owner: "synthetic", repo_name: "vault", branch: "main", vault_path: "/", attachment_folder: "attachments" }]
        : table === "notes" ? [note]
        : [];
      let write = false;
      const q: Row = {
        select: () => q, order: () => q, neq: () => q, limit: () => q, in: () => q, range: () => q, or: () => q, eq: () => q,
        insert: () => { write = true; return q; }, update: () => { write = true; return q; },
        upsert: () => { write = true; return q; }, delete: () => { write = true; return q; },
        single: () => q, maybeSingle: () => q,
        then: (ok: (v: unknown) => unknown) => Promise.resolve(ok(
          write ? { data: null, error: null } : { data: rows[0] ?? null, error: rows[0] ? null : { message: "not found" } },
        )),
      };
      return q;
    },
    storage: { from: () => ({ download: async () => ({ data: null, error: { message: "none" } }) }) },
  };

  const bundle = await build({
    entryPoints: ["supabase/functions/github-sync-export/index.ts"], bundle: true, write: false, platform: "node", format: "cjs",
    plugins: [{
      name: "synthetic-database", setup(b) {
        b.onResolve({ filter: /^https:\/\/esm.sh\/@supabase/ }, (args) => ({ path: args.path, namespace: "fake" }));
        b.onLoad({ filter: /.*/, namespace: "fake" }, () => ({ contents: "export const createClient = () => globalThis.testClient", loader: "js" }));
      },
    }],
  });

  let handler: (req: Request) => Promise<Response>;
  vm.runInNewContext(bundle.outputFiles[0].text, {
    testClient: client, console: { ...console, warn: () => {}, error: () => {}, log: () => {} },
    Request, Response, URL, Headers, AbortSignal, TextEncoder, TextDecoder, Uint8Array, crypto: webcrypto, btoa, atob,
    setTimeout, clearTimeout, encodeURIComponent, encodeURI, escape, unescape,
    fetch: async (url: string, init: RequestInit = {}) => {
      const method = (init.method || "GET").toUpperCase();
      if (method === "GET" && String(url).includes("/contents/")) return new Response("{}", { status: 404 });
      if (method === "PUT") {
        puts.push({ url: String(url), body: JSON.parse(String(init.body)) });
        return Response.json({ content: { sha: "new-sha" }, commit: { sha: "c1" } });
      }
      return Response.json({ name: "vault", default_branch: "main" });
    },
    Deno: {
      env: { get: (key: string) => ({ SUPABASE_URL: "https://synthetic.invalid", SUPABASE_SERVICE_ROLE_KEY: "service-key", SUPABASE_ANON_KEY: "anon" } as Row)[key] },
      serve: (fn: (req: Request) => Promise<Response>) => { handler = fn; },
    },
  });

  const res = await handler!(new Request("https://synthetic.invalid/github-sync-export", {
    method: "POST", headers: { Authorization: "Bearer user-token" }, body: JSON.stringify({ note_id: note.id, action: "update" }),
  }));
  return { status: res.status, body: await res.json() as Row, puts };
}

const utf8FromBase64 = (b64: string) => new TextDecoder().decode(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)));

describe("github-sync-export metadata encoding", () => {
  it("exports a note whose metadata holds characters above U+00FF, and the pull side reads it back", async () => {
    const metadata = { summary: "Plan – Jürgen’s next step 😀", topics: ["Café"], type: "idea" };
    const r = await exportNote({
      id: "n1", user_id: "user-a", title: "Plan", content: "body", tags: [], metadata, is_trashed: false,
      folder_path: "", source_app: null, created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-02T00:00:00Z",
    });
    expect(r.status).toBe(200);
    expect(r.body.success).toBe(true);
    expect(r.puts).toHaveLength(1);

    const file = utf8FromBase64(String(r.puts[0].body.content));
    const line = file.split("\n").find((l) => l.startsWith("menerio_metadata: "));
    expect(line).toBeDefined();
    // Exactly what _shared/github-pull.ts and github-import-vault do.
    const decoded = JSON.parse(atob(line!.slice("menerio_metadata: ".length)));
    expect(decoded).toEqual(metadata);
  });
});
