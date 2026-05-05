# Robust Wikilinks: Resolution, Backfill & Insert UX

Right now `[[Title]]` strings only become real links if they were inserted *after* the WikilinkExtension/Outgoing-panel logic existed AND the cursor landed cleanly. Everything else stays as plain text and never reaches `note_connections`. This plan fixes all four layers so existing and future wikilinks always work.

---

## A. Markdown → Node resolution on load (visual fix)

**File:** `src/components/notes/NoteEditor.tsx` (function `contentToEditorHtml`, ~line 138)

- Before handing markdown/HTML to the editor, run a regex pass over `[[Title]]` patterns (avoiding code blocks).
- For each match, resolve the title against the user's notes via a small in-memory cache (one query per note open: `select id, title from notes where user_id=… and is_trashed=false`).
- Replace matches with the WikilinkExtension's expected HTML:
  ```
  <span data-wikilink="true" data-note-id="…" data-note-title="…" data-display-text="…" class="wikilink-node" contenteditable="false">[[Title]]</span>
  ```
- Unresolved titles → render as `<span class="wikilink-broken">[[Title]]</span>` (red/dashed style, click opens the create-note dialog with the title prefilled). Add the style to `src/index.css`.

**Result:** existing `[[Root Discord DM]]`-style strings instantly become real, clickable, ID-bearing nodes again.

---

## B. Title-fallback in `extractLinkedNoteIds` (sync safety net)

**File:** `src/components/notes/NoteEditor.tsx` (`extractLinkedNoteIds` ~line 122 + `syncManualLinks` ~line 161)

- Extend `extractLinkedNoteIds` to also collect raw `[[Title]]` text occurrences from the editor's text content, not just `wikilink` nodes.
- In `syncManualLinks`, resolve any title-only references to note IDs via a single `select id from notes where user_id=… and lower(title)=any(...)` query before computing the upsert/delete diff.
- Skip self-references and unresolved titles.

**Result:** even if step A is bypassed (e.g. raw paste), the next save still writes the correct `manual_link` rows.

---

## C. One-time backfill edge function

**New file:** `supabase/functions/backfill-wikilinks/index.ts`

- Auth: standard `Authorization` header → per-request Supabase client (per Edge Auth memory rule).
- Logic:
  1. Load all of the user's non-trashed notes (`id, title, content`).
  2. Build a `lower(title) → id` lookup map.
  3. For each note, regex-extract `[[Title]]` matches from `content`.
  4. Resolve to target IDs (skip self, skip unknown).
  5. Diff against existing `manual_link` rows in `note_connections` for that source.
  6. Insert missing rows in batches; do NOT delete existing rows (idempotent, safe to re-run).
  7. Return `{ scanned, links_added, unresolved: [...] }`.

**UI trigger:** add a "Rebuild wikilink connections" button in `src/components/settings/ImportMigrate.tsx` next to existing maintenance actions. Shows result toast with counts.

**Result:** historical wikilinks (including the user's "Root" → "Root Discord DM") become visible in the Outgoing panel without manually re-inserting anything.

---

## D. Robust insert on suggestion accept

**File:** `src/components/notes/NoteEditor.tsx` — wherever `editor.commands.insertWikilink({...})` is called in response to the SuggestedLinksPanel callback (also check `SuggestedLinksPanel.tsx`).

Before inserting:
- Inspect the character immediately to the left and right of the current selection.
- If the left char is a non-whitespace word character, prepend a space.
- If the right char is a non-whitespace word character, append a space.
- If the editor is currently focused inside a word (selection is a caret in the middle of a text node), move the caret to the end of that word first.

**Result:** prevents future occurrences like `Fv[[Root Discord DM]]ctory`.

---

## Out of scope

- Renaming notes does not auto-update existing `[[Title]]` strings (Obsidian behavior). Could be a follow-up.
- No changes to graph rendering, suggestions ranking, or the WikilinkExtension itself.
- No DB schema changes.

---

## Technical notes

- All four changes are additive; no migrations.
- Resolution queries are scoped by `user_id` (RLS already enforces this).
- The backfill function deduplicates per `(source, target)` pair before insert; existing unique constraints on `note_connections` (if any) plus the existence-check make it safe to re-run.
- Title matching is **case-insensitive, exact** (no fuzzy) to match Obsidian's wikilink semantics.
