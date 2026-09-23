// @vitest-environment node
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

// Reads that used to move data nobody used, pinned at the source like the
// other function tests here (these files import Deno-only modules).
const read = (path: string) => readFileSync(path, "utf8");

describe("wide reads in edge functions", () => {
  it("github export never selects * from notes (that carried the embedding)", () => {
    const src = read("supabase/functions/github-sync-export/index.ts");
    expect(src).not.toMatch(/from\("notes"\)\s*\.select\("\*"\)/);
    expect(src.match(/\.select\(EXPORT_NOTE_COLUMNS\)/g)?.length).toBe(2);
    expect(src).not.toMatch(/EXPORT_NOTE_COLUMNS =\s*"[^"]*embedding/);
  });

  it("github pull lists notes without their bodies and loads a body only to push it", () => {
    const src = read("supabase/functions/_shared/github-pull.ts");
    expect(src).toContain('.select("id, updated_at, source_app")');
    expect(src).not.toMatch(/selectAllRows<any>\(\(from, to\) => serviceClient\.from\("notes"\)\.select\("[^"]*content/);
  });

  it("wiki-ingest lists pages without content and re-reads only the touched ones", () => {
    const src = read("supabase/functions/wiki-ingest/index.ts");
    expect(src).toContain('.select("id, slug, title, page_type, summary, protected_sections, updated_at")');
    expect(src).toMatch(/\.in\("slug", touchedSlugs\)/);
  });

  it("compute-connections writes edges in batches and does not load the note body", () => {
    const src = read("supabase/functions/compute-connections/index.ts");
    expect(src).toMatch(/\.upsert\(batch, \{ onConflict: "source_note_id,target_note_id,connection_type" \}\)/);
    expect(src).toContain('.select("id, user_id, title, metadata, embedding, ai_visibility")');
  });

  it("backfill-metadata does not re-embed a note that already has a vector", () => {
    const src = read("supabase/functions/backfill-metadata/index.ts");
    expect(src).toMatch(/alreadyEmbedded\.has\(note\.id\) \? Promise\.resolve\(null\)/);
    expect(src).toContain("TIME_BUDGET_MS");
  });

  it("get-graph-data does not put the whole id set into every edge query", () => {
    const src = read("supabase/functions/get-graph-data/index.ts");
    const fullGraph = src.slice(src.indexOf("// Full graph mode"));
    expect(fullGraph).not.toMatch(/\.in\("target_note_id", noteIds\)/);
    expect(fullGraph).toContain("Promise.all(");
  });
});
