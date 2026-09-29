import { describe, expect, it, vi } from "vitest";
import { fakeDb, loadEndpoint } from "./edge-harness";

const OWNER_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OWNER_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

describe("wiki-restructure cron sweep", () => {
  it("files each account's results only in that account's log", async () => {
    const pages = [
      { id: "pa", user_id: OWNER_A, slug: "alice-notes", title: "Alice", content: "raw a", protected_sections: [] },
      { id: "pb", user_id: OWNER_B, slug: "bobs-diagnosis", title: "Bob", content: "raw b", protected_sections: [] },
    ];
    const db = fakeDb((q) => (q.table === "wiki_pages" && q.has("select") && !q.has("update") ? { data: pages } : { data: null }));
    const background: Promise<unknown>[] = [];
    const runChat = vi.fn(async (args: any) => ({ content: JSON.stringify({ content: args.userId === OWNER_A ? "formatted a" : "" }) }));
    const handler = loadEndpoint("supabase/functions/wiki-restructure/index.ts", {
      "https://esm.sh/@supabase/supabase-js@2": { createClient: () => db.client },
      "../_shared/cron-auth.ts": { isValidCronRequest: async () => true },
      "../_shared/llm-router.ts": { runChat },
      "../_shared/llm-defaults.ts": { WIKI_RESTRUCTURE_PROMPT: "fixture" },
      "../_shared/wiki-structure.ts": {
        analyzeStructure: () => ({ chars: 1, headingCount: 0, maxParagraphWords: 1, maxSectionWords: 1 }),
        chunkMarkdown: (text: string) => [text], missingFacts: () => [],
        needsRestructure: () => true, softStructure: (text: string) => text,
      },
    }, { SUPABASE_URL: "https://fixture.invalid", SUPABASE_ANON_KEY: "fixture-anon", SUPABASE_SERVICE_ROLE_KEY: "fixture-service" },
    { waitUntil: (p) => background.push(p) });

    const res = await handler(new Request("https://fixture.invalid/wiki-restructure", {
      method: "POST", headers: { "Content-Type": "application/json", "x-cron-key": "fixture" },
      body: JSON.stringify({ cron: "wiki-restructure" }),
    }));
    expect(res.status).toBe(202);
    await Promise.all(background);

    const logs = db.on("wiki_log").map((q) => q.ops.find((op) => op[0] === "insert")![1] as any);
    for (const entry of logs) {
      const slugs = (entry.details.results as { slug: string }[]).map((r) => r.slug);
      const expected = entry.user_id === OWNER_A ? "alice-notes" : "bobs-diagnosis";
      expect(slugs.every((s) => s === expected)).toBe(true);
    }
    const summary = logs.find((e) => e.details.summary);
    expect(summary.user_id).toBe(OWNER_A);
    expect(summary.details.total).toBe(1);
    expect(JSON.stringify(summary)).not.toContain("bobs-diagnosis");
  });
});
