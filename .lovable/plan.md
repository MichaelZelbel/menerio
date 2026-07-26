## What's wrong today

The `michael` Lexicon page is 55,116 characters with only 158 line breaks — effectively one enormous paragraph. Across all 350 pages: 21 have no headings at all, 15 are over 3,000 characters, average length is 926 chars. The cause is in the synthesis pipeline, not the renderer:

- The `wiki-ingest` prompt only says "use short paragraphs and 2–4 sections" — a soft suggestion with no enforced structure, no length ceiling, and no rule against ever-growing prose.
- Updates ask the model to return the **full page** and "prefer additive updates", so each new note glues another sentence onto the same blob. Over months this compounds into a wall.
- The frontend's `normalizeWikiContent` only splits text into paragraphs when the page is under a threshold and has no markdown structure — it can't rescue a 55k blob.

## Plan

### 1. A required page template (the contract)

Every Lexicon page must follow one shape, enforced everywhere:

```text
<one-sentence definition, plain text, no heading>

## Overview
2-4 short paragraphs, max ~80 words each

## Key facts
- bullet per fact, one line each

## <Topic sections, as many as needed>
Short paragraphs or bullets under descriptive H2s
(e.g. "## Projects", "## Preferences", "## Relationships")

## Open questions      (optional)
## Contradictions      (optional, only when sources conflict)
```

Hard rules: no paragraph over ~80 words, no section over ~250 words (split into sub-topics instead), sentences stay short, facts of the same kind get grouped under one H2 rather than appended chronologically.

### 2. Fix generation (new pages are always structured)

- Rewrite the `wiki-ingest` system prompt in `supabase/functions/_shared/llm-defaults.ts` to embed the template above, with the length ceilings and an explicit "never emit a paragraph longer than 80 words" rule.
- Update the same prompt row in `llm_call_configs` (`call_site: wiki-ingest.main`) so the live config matches the default — the DB copy is what actually runs.
- Change the update rule from "append to the end" to "place each new fact under the correct existing H2; create a new H2 if none fits; never grow a paragraph past the ceiling".

### 3. Structural validation before any write

Add a shared `wiki-structure.ts` module used by `wiki-ingest` (and reused by the backfill):

- `analyzeStructure(markdown)` → paragraph word counts, section word counts, heading presence, total length.
- `needsRestructure(markdown)` → true when a page has no H2, a paragraph over the word ceiling, or a section over the section ceiling.
- `softStructure(markdown)` → deterministic repair used as a safety net: splits runaway paragraphs at sentence boundaries into ~3-sentence paragraphs, promotes obvious list-like runs into bullets. No facts added or removed.

`wiki-ingest` runs `softStructure` on every `content`/`patch` before saving, so even a badly behaved model response never lands as a wall of text.

### 4. Backfill all existing pages

New edge function `wiki-restructure`:

- `POST { scope: "all" | "user" | "slugs", dry_run?: boolean }`, admin/owner scoped.
- Selects pages where `needsRestructure` is true, processes them in the background via `EdgeRuntime.waitUntil`, returns a job id immediately (same pattern as `review-queue-bulk`).
- Per page: deterministic `softStructure` first, then one LLM pass with a **reformat-only** prompt — reorganise into the template, group related facts, split long paragraphs. Explicitly forbidden: adding facts, removing facts, changing wikilinks, adding a Sources section.
- **Lossless guard** before saving: extract the fact-bearing content of the before/after (all `[[slugs]]`, all numbers, all capitalised entity tokens). If the after-version drops any of them, the rewrite is rejected and the page keeps only the deterministic `softStructure` result. Long pages are chunked by existing paragraph groups so the 55k page doesn't blow the context window.
- Writes a `wiki_revisions` row with `change_type: 'restructured'` for every page, so any page can be rolled back from the existing revisions UI.
- Respects `protected_sections` — user-edited sections are moved but never reworded.

Then run it once over all 350 pages (dry run first, reporting counts and a sample diff).

### 5. Keep it that way

- A `pg_cron` job (weekly) calls `wiki-restructure` with `scope: "all"`, which is a no-op for pages that already pass `needsRestructure`.
- Extend `wiki-lint` to report "unstructured page" as a finding type, so the Lexicon health route surfaces regressions.

### 6. Reading experience (frontend)

In `src/pages/WikiPage.tsx`:

- Replace `normalizeWikiContent` with the shared structure helper so the client-side fallback matches the server rules.
- Constrain article measure (~72ch), increase paragraph spacing and line height for the Lexicon article view, and style H2/H3 with clear separation.
- Long pages: collapse sections beyond the first few behind an expandable control, with the existing "On this page" rail as the primary navigation.

## Technical notes

- Files: `supabase/functions/_shared/llm-defaults.ts`, new `supabase/functions/_shared/wiki-structure.ts`, `supabase/functions/wiki-ingest/index.ts`, new `supabase/functions/wiki-restructure/index.ts`, `supabase/functions/wiki-lint/index.ts`, `src/pages/WikiPage.tsx`, `src/index.css` (Lexicon article typography).
- Migration: one row update on `llm_call_configs` for `wiki-ingest.main`, a `wiki-restructure.main` config row, and the cron schedule.
- Cost: the backfill is one LLM call per unstructured page (roughly 21–40 pages by current counts, plus chunked calls for the 15 oversized ones). Pages that already look fine are skipped.
- Verification before I report done: re-run the structure query (`no_headings`, `very_long`, max paragraph length) and show the before/after of the `michael` page.
