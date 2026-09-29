import { describe, expect, it, vi } from "vitest";
import { fakeDb, loadEndpoint, postJson, type QueryLog } from "./edge-harness";
import { selectAllRows } from "../paged-select.ts";

/** Serve `rows` the way PostgREST does: the requested range, never more than 1000. */
function ranged(q: QueryLog, rows: unknown[]) {
  const range = q.ops.find((op) => op[0] === "range");
  if (!range) return { data: rows.slice(0, 1000) };
  const from = range[1] as number;
  const to = Math.min(range[2] as number, from + 999);
  return { data: rows.slice(from, to + 1) };
}

function setup(respond: (q: QueryLog) => { data?: unknown; error?: unknown; count?: number }) {
  const db = fakeDb(respond);
  const handler = loadEndpoint("supabase/functions/wiki-lint/index.ts", {
    "https://esm.sh/@supabase/supabase-js@2": { createClient: () => db.client },
    "../_shared/llm-router.ts": { resolveSystemPrompt: async () => "fixture prompt" },
    "../_shared/llm-credits.ts": {
      openRouterWithCredits: vi.fn(async () => ({ result: { choices: [{ message: { content: "{}" } }] } })),
    },
    "../_shared/llm-defaults.ts": { WIKI_LINT_PROMPT: "fixture" },
    "../_shared/paged-select.ts": { selectAllRows },
  }, {
    SUPABASE_URL: "https://fixture.invalid", SUPABASE_ANON_KEY: "fixture-anon",
    SUPABASE_SERVICE_ROLE_KEY: "fixture-service", OPENROUTER_API_KEY: "fixture-key",
  });
  return { db, call: () => handler(postJson("https://fixture.invalid/wiki-lint", {})) };
}

describe("wiki-lint", () => {
  it("logs a failure and answers its own 500 with CORS headers", async () => {
    const { db, call } = setup((q) => q.table === "wiki_pages" ? { error: { message: "boom" } } : { data: null });
    const res = await call();
    expect(res.status).toBe(500);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(await res.json()).toEqual({ error: "Lexicon health check failed" });
    const log = db.on("wiki_log").find((q) => q.has("insert"));
    expect((log!.ops.find((op) => op[0] === "insert")![1] as any).operation).toBe("lint_failed");
  });

  it("counts orphans against every link, not the first 1000", async () => {
    const pages = Array.from({ length: 1200 }, (_, i) => ({ id: `p${i}`, slug: `page-${i}`, title: `Page ${i}`, page_type: "concept", content: "x", updated_at: "2026-09-01T00:00:00Z" }));
    // Every page is linked to exactly once; the link to the last page sits past row 1000.
    const links = pages.map((p, i) => ({ id: `l${i}`, source_page_id: pages[(i + 1) % pages.length].id, target_slug: p.slug, target_page_id: p.id }));
    const { call } = setup((q) => {
      if (q.table === "wiki_pages") return ranged(q, pages);
      if (q.table === "wiki_links") return ranged(q, links);
      if (q.table === "notes") return { count: 0 };
      return { data: null };
    });
    const res = await call();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.counts.orphan_pages).toBe(0);
    expect(body.counts.unresolved_wikilinks).toBe(0);
  });
});
