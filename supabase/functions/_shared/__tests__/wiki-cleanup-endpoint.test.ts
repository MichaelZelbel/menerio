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
  const openRouterWithCredits = vi.fn(async () => ({
    result: { choices: [{ message: { content: JSON.stringify({ title: "Rebuilt", summary: "s", content: "## Rebuilt\nFrom sources" }) } }] },
  }));
  const handler = loadEndpoint("supabase/functions/wiki-cleanup/index.ts", {
    "https://esm.sh/@supabase/supabase-js@2": { createClient: () => db.client },
    "../_shared/llm-router.ts": { parseModelJson: (raw: string) => JSON.parse(raw), resolveSystemPrompt: async () => "fixture prompt" },
    "../_shared/llm-credits.ts": { openRouterWithCredits },
    "../_shared/llm-defaults.ts": { WIKI_CLEANUP_PROMPT: "fixture" },
    "../_shared/prompt-safety.ts": { sanitizePromptText: (v: unknown, max = 500) => String(v ?? "").slice(0, max) },
    "../_shared/paged-select.ts": { selectAllRows },
  }, {
    SUPABASE_URL: "https://fixture.invalid", SUPABASE_ANON_KEY: "fixture-anon",
    SUPABASE_SERVICE_ROLE_KEY: "fixture-service", OPENROUTER_API_KEY: "fixture-key",
  });
  return { db, openRouterWithCredits, call: (body: unknown) => handler(postJson("https://fixture.invalid/wiki-cleanup", body)) };
}

describe("wiki-cleanup rebuild_page", () => {
  it("leaves notes in the bin out of the rebuild prompt", async () => {
    const s = setup((q) => {
      if (q.table === "wiki_pages" && q.has("maybeSingle")) return { data: { id: "p1", slug: "topic", title: "Topic", page_type: "concept", content: "old" } };
      if (q.table === "wiki_pages") return ranged(q, [{ id: "p1", slug: "topic" }]);
      if (q.table === "wiki_page_sources") return { data: [
        { note_id: "n1", notes: { id: "n1", title: "Kept", content: "Visible source text", ai_visibility: "visible", is_trashed: false } },
        { note_id: "n2", notes: { id: "n2", title: "Binned", content: "Deleted secret text", ai_visibility: "visible", is_trashed: true } },
      ] };
      return { data: null };
    });
    const res = await s.call({ mode: "rebuild_page", page_id: "p1" });
    expect(res.status).toBe(200);
    const userMessage = (s.openRouterWithCredits.mock.calls[0] as any)[5].messages[1].content as string;
    expect(userMessage).toContain("Visible source text");
    expect(userMessage).not.toContain("Deleted secret text");
  });
});

describe("wiki-cleanup candidates", () => {
  it("counts backlinks past the first 1000 links, so linked pages are not deleted", async () => {
    const pages = Array.from({ length: 30 }, (_, i) => ({ id: `p${i}`, slug: `page-${i}`, title: `Page ${i}`, page_type: "concept", content: "x".repeat(300), source_count: 0, updated_at: "2026-09-01" }));
    // 1000 links among the first pages, then one link each to every page.
    const filler = Array.from({ length: 1000 }, (_, i) => ({ id: `f${i}`, source_page_id: "p0", target_page_id: "p1" }));
    const tail = pages.map((p, i) => ({ id: `t${i}`, source_page_id: "p1", target_page_id: p.id }));
    const s = setup((q) => {
      if (q.table === "wiki_pages" && q.has("select")) return ranged(q, pages);
      if (q.table === "wiki_links" && q.has("select")) return ranged(q, [...filler, ...tail]);
      return { data: null };
    });
    const res = await s.call({ mode: "delete" });
    const body = await res.json();
    expect(body.candidates).toEqual([]);
    expect(body.deleted).toBe(0);
    expect(s.db.on("wiki_pages").some((q) => q.has("delete"))).toBe(false);
  });

  it("does not strip links to pages past the first 1000", async () => {
    const pages = Array.from({ length: 1100 }, (_, i) => ({ id: `p${String(i).padStart(4, "0")}`, slug: `page-${i}`, content: i === 0 ? "See [[page-1099]]." : "x" }));
    const s = setup((q) => (q.table === "wiki_pages" && q.has("select") ? ranged(q, pages) : { data: null }));
    const res = await s.call({ mode: "strip_dead_links" });
    const body = await res.json();
    expect(body.links_removed).toBe(0);
    expect(s.db.on("wiki_pages").some((q) => q.has("update"))).toBe(false);
  });
});
