// @vitest-environment node
import { describe, expect, it } from "vitest";
import { build } from "esbuild";
import vm from "node:vm";
import { webcrypto } from "node:crypto";
import type { Row } from "./memory-db";

/**
 * github-sync-export, run as deployed (the real index.ts, bundled), against a
 * synthetic database and a synthetic GitHub. The point under test: a mirrored
 * hub file is never written to the vault, and nothing already there is deleted.
 */

interface GhCall { method: string; url: string }

async function harness(notes: Row[]) {
  const github: GhCall[] = [];
  const noteQueries: { or?: string }[] = [];
  const client = {
    auth: { getClaims: async () => ({ data: { claims: { sub: "user-a" } }, error: null }) },
    async rpc() { return { data: null, error: null }; },
    from(table: string) {
      let rows: Row[] =
        table === "github_connections" ? [{ user_id: "user-a", sync_enabled: true, github_token: "gh-token", repo_owner: "synthetic", repo_name: "vault", branch: "main", vault_path: "/", attachment_folder: "attachments" }]
        : table === "notes" ? [...notes]
        : [];
      const seen: { or?: string } = {};
      if (table === "notes") noteQueries.push(seen);
      let write = false, one = false, window: [number, number] | null = null;
      const q: Row = {
        select: () => q, order: () => q, neq: () => q, limit: () => q,
        insert: () => { write = true; return q; }, update: () => { write = true; return q; },
        upsert: () => { write = true; return q; }, delete: () => { write = true; return q; },
        eq: (k: string, v: unknown) => { if (!write) rows = rows.filter((r) => r[k] === undefined || r[k] === v); return q; },
        in: () => q,
        or: (expr: string) => {
          seen.or = expr;
          // The one .or() this function uses on notes: leave the hub mirror out.
          if (expr.includes("source_app")) rows = rows.filter((r) => String(r.source_app ?? "").toLowerCase() !== "hub");
          return q;
        },
        range: (from: number, to: number) => { window = [from, to]; return q; },
        single: () => { one = true; return q; }, maybeSingle: () => { one = true; return q; },
        then: (ok: (v: unknown) => unknown) => Promise.resolve(ok(
          write ? { data: null, error: null }
          : one ? { data: rows[0] ?? null, error: rows[0] ? null : { message: "not found" } }
          : { data: window ? rows.slice(window[0], window[1] + 1) : rows, error: null },
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
    Request, Response, URL, Headers, AbortSignal, TextEncoder, TextDecoder, Uint8Array, crypto: webcrypto, btoa, atob, setTimeout, clearTimeout,
    encodeURIComponent, encodeURI,
    fetch: async (url: string, init: RequestInit = {}) => {
      const method = (init.method || "GET").toUpperCase();
      github.push({ method, url: String(url) });
      if (method === "GET" && String(url).includes("/contents/")) return new Response("{}", { status: 404 });
      if (method === "PUT") return Response.json({ content: { sha: "new-sha", path: "x" }, commit: { sha: "c1" } });
      return Response.json({ name: "vault", default_branch: "main" });
    },
    Deno: {
      env: { get: (key: string) => ({ SUPABASE_URL: "https://synthetic.invalid", SUPABASE_SERVICE_ROLE_KEY: "service-key", SUPABASE_ANON_KEY: "anon" } as Row)[key] },
      serve: (fn: (req: Request) => Promise<Response>) => { handler = fn; },
    },
  });

  return {
    github, noteQueries,
    writes: () => github.filter((c) => c.method === "PUT" || c.method === "DELETE"),
    invoke: async (body: Row) => {
      const res = await handler!(new Request("https://synthetic.invalid/github-sync-export", {
        method: "POST", headers: { Authorization: "Bearer user-token" }, body: JSON.stringify(body),
      }));
      return { status: res.status, body: await res.json() as Row };
    },
  };
}

const note = (id: string, source_app: string | null, over: Row = {}): Row => ({
  id, user_id: "user-a", title: id, content: `body of ${id}`, tags: [], metadata: {}, is_trashed: false,
  folder_path: source_app && source_app.trim().toLowerCase() === "hub" ? "hub/rules" : "", source_app,
  created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-02T00:00:00Z", ...over,
});

describe("github-sync-export leaves the hub mirror alone", () => {
  it.each(["create", "update", "delete"])("single note, action %s: a hub file is skipped and GitHub is never called", async (action) => {
    const h = await harness([note("hub-1", "hub")]);
    const r = await h.invoke({ note_id: "hub-1", action });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ success: true, skipped: true, reason: "hub_mirror" });
    // No write, no delete of an earlier export, not even the repository check.
    expect(h.github).toEqual([]);
  });

  it.each([" HUB ", "Hub"])("recognises source_app %j the way shouldExtractFacts does", async (sourceApp) => {
    const h = await harness([note("hub-1", sourceApp)]);
    const r = await h.invoke({ note_id: "hub-1", action: "update" });
    expect(r.body.skipped).toBe(true);
    expect(h.writes()).toEqual([]);
  });

  it("still exports a note the user wrote, and one from the older hub-api sender", async () => {
    for (const sourceApp of ["web", null, "hub-api"]) {
      const h = await harness([note("mine", sourceApp)]);
      const r = await h.invoke({ note_id: "mine", action: "update" });
      expect(r.body.success).toBe(true);
      expect(r.body.skipped).toBeUndefined();
      expect(h.writes().map((c) => c.method)).toEqual(["PUT"]);
    }
  });

  it("bulk: exports every native note and no hub file, and deletes nothing", async () => {
    const h = await harness([note("mine-1", "web"), note("hub-1", "hub"), note("mine-2", null), note("hub-2", " HUB "), note("hub-3", "Hub")]);
    const r = await h.invoke({ bulk: true });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ success: true, total: 2, succeeded: 2, failed: 0 });
    expect(r.body.results.map((x: Row) => x.note_id).sort()).toEqual(["mine-1", "mine-2"]);
    const puts = h.writes();
    expect(puts.map((c) => c.method)).toEqual(["PUT", "PUT"]);
    expect(puts.some((c) => c.url.includes("/hub/") || c.url.includes("hub-"))).toBe(false);
    expect(h.github.some((c) => c.method === "DELETE")).toBe(false);
  });

  it("bulk: asks the database to leave the mirror out, so its bodies are never downloaded", async () => {
    const h = await harness([note("mine-1", "web"), note("hub-1", "hub")]);
    await h.invoke({ bulk: true });
    expect(h.noteQueries.some((q) => q.or === "source_app.is.null,source_app.not.ilike.hub")).toBe(true);
  });
});
