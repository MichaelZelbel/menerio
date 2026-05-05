# Outgoing Links Panel

Add a new collapsible panel that shows all notes the current note links **to** (manual `[[wikilinks]]`), mirroring the existing `BacklinksPanel`.

## Why
Currently you can only see *who links to me* (Backlinks). When you insert a wikilink via the Suggested Links panel, it gets dropped into the editor body — but there's no compact list view to see all outgoing links of a note at a glance.

## What to build

**New file: `src/components/notes/OutgoingLinksPanel.tsx`**
- Same UX shell as `BacklinksPanel` (collapsible header, count badge, empty state).
- Query `note_connections` where `source_note_id = noteId` AND `connection_type = 'manual_link'`.
- Resolve `target_note_id` → fetch `notes (id, title, updated_at)`, filter `is_trashed = false`.
- Render each as a clickable row → `onNavigate(targetId)`.
- Header label: "Links" with `ArrowUpRight` icon, count in parentheses.
- Empty state copy: "This note doesn't link to any other notes yet. Use [[wikilinks]] in the editor to create connections."

**Wire into `src/components/notes/NoteEditor.tsx`**
- Import and render `<OutgoingLinksPanel noteId={note.id} onNavigate={handleNavigateToNote} />` directly **above** the existing `<BacklinksPanel ... />` (line ~1158), so the order in the right rail reads: Links → Backlinks → Suggested Links.

## Technical notes
- Uses existing `note_connections` table; no schema changes, no edge function, no new RLS.
- `manual_link` rows are already kept in sync with `[[wikilinks]]` in the editor body (see `mem://features/wikilinks-and-backlinks`), so this panel will reflect inserts/removals automatically after the next save.
- React Query key: `["outgoing-links", noteId, user?.id]` so it invalidates per note.

## Out of scope
- No changes to graph, suggestions, or wikilink extension.
- Not adding inline anchors/jump-to-position in the body (separate feature).
