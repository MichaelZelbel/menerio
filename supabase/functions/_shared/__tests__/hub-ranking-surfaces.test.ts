// @vitest-environment node
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { build } from "esbuild";
import vm from "node:vm";
import { webcrypto } from "node:crypto";
import type { Row } from "./memory-db";

/**
 * The hub ranking policy is one file; these tests hold every surface that ranks
 * notes to actually using it. search-notes-semantic is run for real (bundled,
 * with a synthetic database). The MCP server is too large to boot in a unit
 * test, so for it the wiring is asserted on the source and the ordering itself
 * is covered by hub-ranking.test.ts, which tests the function it calls.
 */


async function semanticSearch(options: { tokens?: number; chunks: Row[]; notes: Row[] }) {
  const client = {
    auth: { getUser: async () => ({ data: { user: { id: "user-a" } }, error: null }) },
    async rpc(name: string) {
      if (name === "match_note_chunks") return { data: options.chunks, error: null };
      if (name === "match_media") return { data: [], error: null };
      if (name === "deduct_ai_tokens_attributed") return { data: { allowed: true, remaining_tokens: 1, remaining_credits: 1 }, error: null };
      return { data: null, error: { message: `unexpected rpc ${name}` } };
    },
    from(table: string) {
      let rows: Row[] = table === "v_ai_allowance_current"
        ? [{ user_id: "user-a", remaining_tokens: options.tokens ?? 1_000_000, remaining_credits: 10, period_start: "2026-09-01" }]
        : table === "notes" ? [...options.notes] : [];
      const q: Row = {
        select: () => q, order: () => q,
        eq: (k: string, v: unknown) => { rows = rows.filter((r) => r[k] === v); return q; },
        in: (k: string, vs: unknown[]) => { rows = rows.filter((r) => vs.includes(r[k])); return q; },
        or: (expr: string) => {
          const needle = (/ilike\."%(.*?)%"/.exec(expr)?.[1] ?? "").toLowerCase();
          rows = rows.filter((r) => `${r.title}\n${r.content}`.toLowerCase().includes(needle));
          return q;
        },
        limit: (n: number) => { rows = rows.slice(0, n); return q; },
        then: (ok: (v: unknown) => unknown) => Promise.resolve(ok({ data: rows, error: null })),
      };
      return q;
    },
  };
  const bundle = await build({
    entryPoints: ["supabase/functions/search-notes-semantic/index.ts"], bundle: true, write: false, platform: "node", format: "cjs",
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
    Request, Response, URL, Headers, AbortSignal, TextEncoder, crypto: webcrypto, setTimeout, clearTimeout,
    fetch: async () => Response.json({ data: [{ embedding: [0.1, 0.2] }], usage: { prompt_tokens: 3, total_tokens: 3 } }),
    Deno: {
      env: { get: (key: string) => ({ SUPABASE_URL: "https://synthetic.invalid", SUPABASE_SERVICE_ROLE_KEY: "service-key", SUPABASE_ANON_KEY: "anon", OPENROUTER_API_KEY: "provider-key" } as Row)[key] },
      serve: (fn: (req: Request) => Promise<Response>) => { handler = fn; },
    },
  });
  const res = await handler!(new Request("https://synthetic.invalid/search-notes-semantic", {
    method: "POST", headers: { Authorization: "Bearer user-token" }, body: JSON.stringify({ query: "root canal", scope: "notes" }),
  }));
  return await res.json() as { results: Row[]; mode: string };
}

const note = (id: string, source_app: string | null, updated_at = "2026-01-01T00:00:00Z"): Row => ({
  id, user_id: "user-a", title: id, content: "root canal", is_trashed: false, source_app, ai_visibility: "visible", updated_at,
});

describe("search-notes-semantic", () => {
  it("orders by discounted similarity: a hub file needs a clear lead to pass a native note", async () => {
    const notes = [note("hub-close", "hub"), note("native", "web"), note("hub-far-ahead", " HUB ")];
    const body = await semanticSearch({ notes, chunks: [
      { note_id: "hub-close", similarity: 0.80, content: "c", note_title: "hub-close" },      // 0.68 to order by
      { note_id: "native", similarity: 0.70, content: "c", note_title: "native" },
      { note_id: "hub-far-ahead", similarity: 0.90, content: "c", note_title: "hub-far-ahead" }, // 0.765
    ] });
    expect(body.mode).toBe("semantic");
    expect(body.results.map((r) => r.id)).toEqual(["hub-far-ahead", "native", "hub-close"]);
    // What the app prints is still the measurement.
    expect(body.results.map((r) => r.similarity)).toEqual([0.90, 0.70, 0.80]);
  });

  it("puts native notes first in the no-credits text fallback, recency kept inside each group", async () => {
    const notes = [note("hub-new", "hub", "2026-09-01T00:00:00Z"), note("native-old", "web", "2026-01-01T00:00:00Z"), note("native-new", null, "2026-08-01T00:00:00Z")];
    const body = await semanticSearch({ tokens: 0, notes, chunks: [] });
    expect(body.mode).toBe("ilike_fallback_no_credits");
    expect(body.results.map((r) => r.id)).toEqual(["native-old", "native-new", "hub-new"]);
  });
});

describe("every other ranking surface is wired to the one policy", () => {
  const read = (p: string) => readFileSync(p, "utf8");

  it("MCP hybridSearchNotes ranks with rankHybridRows and filters with matchesSourceFilter", () => {
    const mcp = read("supabase/functions/menerio-mcp/index.ts");
    const fn = mcp.slice(mcp.indexOf("async function hybridSearchNotes("), mcp.indexOf("async function searchClaims("));
    expect(fn).toContain("rankHybridRows(merged, query)");
    expect(fn).toContain("matchesSourceFilter(r.source_app, source)");
    // Both arms must fetch the columns the policy and the label read.
    expect(fn.match(/ai_visibility, source_app, source_id"/g)).toHaveLength(2);
    // The hand-rolled tier sort is gone, so there is no second ordering to drift.
    expect(fn).not.toContain("const tierOf");
  });

  it("MCP results label a hub file, and search_notes takes a source", () => {
    const mcp = read("supabase/functions/menerio-mcp/index.ts");
    const fmt = mcp.slice(mcp.indexOf("function formatNoteResult("), mcp.indexOf("function noteText("));
    expect(fmt).toContain("hubFileLabel(t.source_app, t.source_id)");
    expect(fmt.indexOf("hubFileLabel")).toBeLessThan(fmt.indexOf('if (view === "metadata")'));
    expect(mcp).toContain('source: z.enum(["all", "native", "hub"]).optional().default("all")');
    expect(mcp).toContain("hybridSearchNotes(query, limit, threshold, source)");
  });

  it("the Hub API search ranks through the same function", () => {
    expect(read("supabase/functions/_shared/note-search.ts")).toContain("rankHybridRows(Array.from(byNote.values()), query)");
    expect(read("supabase/functions/hub-api-notes/index.ts")).toContain("combinedNoteSearch(supabase,");
  });

  it("the app's keyword scorer uses the frontend twin, and its callers select source_app", () => {
    expect(read("src/lib/search-terms.ts")).toContain('from "@/lib/hub-ranking"');
    expect(read("src/components/notes/WikilinkAutocomplete.tsx")).toContain('"id, title, metadata, updated_at, source_app"');
    expect(read("src/components/profile/NoteSearchInput.tsx")).toContain('"id, title, updated_at, source_app"');
    expect(read("src/hooks/useNotes.ts")).toMatch(/NOTE_COLUMNS =\s*"[^"]*source_app/);
  });
});
