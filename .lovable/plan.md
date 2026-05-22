# Preserve Blank Lines in Notes

## Problem
When you press Enter twice in a note to create a blank line between paragraphs, that blank line disappears on save/reload. Obsidian preserves arbitrary blank lines — Querino should too.

## Root cause
In `src/utils/markdown-converter.ts`, three places strip blank paragraphs:

1. `tiptapJsonToMarkdown` (line 378): `serializeBlock` on `doc` calls `.filter(Boolean)` — empty paragraphs (which serialize to `""`) are dropped before joining with `\n\n`.
2. `tiptapJsonToMarkdown` (line 182) and `htmlToMarkdown` (line 170): both run `.replace(/\n{3,}/g, "\n\n")` which collapses any preserved gap back to a single blank line.
3. `markdownToHtml` (line 223): when splitting on `\n{2,}`, empty blocks are skipped via `if (!trimmed) continue;`, so a markdown gap of `\n\n\n\n` round-trips to a single `\n\n`.

Result: editor → markdown → editor always normalises consecutive blank lines down to one.

## Fix
Treat empty paragraphs as a meaningful "blank line" block, end to end.

### 1. Serialize empty paragraphs (TipTap → Markdown)
- In `serializeBlock`, the `doc` branch: keep empty strings. Replace `.filter(Boolean)` with logic that preserves empty paragraphs as a literal empty entry, so two consecutive empty paragraphs produce an extra `\n\n` (i.e. one blank line in markdown).
- Stop collapsing `\n{3,}` → `\n\n` in `tiptapJsonToMarkdown`. Leave the user's whitespace intact.

### 2. Parse blank blocks (Markdown → HTML)
- In `markdownToHtml`, split on `\n{2,}` but capture the count so we know how many gaps existed. For every extra blank gap beyond the first, emit an empty `<p></p>` block (TipTap renders this as an empty paragraph the user can see and keep).
- Stop skipping empty trimmed blocks; emit `<p></p>` instead.

### 3. HTML → Markdown symmetry
- In `htmlToMarkdown`: render `<p></p>` (no inline content) as `\n\n` (producing a blank line), and remove the `\n{3,}` → `\n\n` collapse.

### 4. Note-content guard
- `coalesceTaskList` in `src/lib/note-content.ts` already only collapses blanks between task-list items, which is correct Obsidian behaviour — leave it alone.

## Verification
- Add unit tests in `src/utils/__tests__/markdown-converter.test.ts`:
  - `paragraph\n\n\n\nparagraph` round-trips through `markdownToHtml` → `tiptapJsonToMarkdown` unchanged.
  - Two consecutive empty paragraphs in a TipTap doc serialize to two blank lines in markdown.
- Manually: in a note, press Enter several times between two paragraphs, save, reload — blank lines must remain.

## Files touched
- `src/utils/markdown-converter.ts` (serializer, parser, htmlToMarkdown)
- `src/utils/__tests__/markdown-converter.test.ts` (new tests)

No DB migration, no schema change, no UI change beyond editor behaviour.
