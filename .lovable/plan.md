# Fix Orphan Notes Tile

The tile in `src/components/graph/OrphanNotesDetector.tsx` currently has three issues you flagged:

1. **Wrong count.** Connection detection uses `useGraphData({ limit: 500 })`, which caps both nodes and edges. Notes that *do* have connections outside that window are incorrectly counted as orphans (and vice‑versa).
2. **AI‑hidden notes appear.** Notes you set to "Hidden from AI" still show up.
3. **"View all orphans" jumps to the graph**, where orphans are hidden by default and the displayed count differs.

## Changes

### 1. New hook `useOrphanNotes`
Single source of truth, used by both the dashboard tile and the new list page.

- Query the `notes` table for `is_trashed=false`, `ai_visibility='visible'` (server‑side filter) for the current user.
- In parallel, query `note_connections` for `user_id=current` and collect every `source_note_id` and `target_note_id` into a `Set`.
- Also union in `metadata.matched_people`‑derived links? No — stick to `note_connections` since that is what the graph uses. Orphan = no row in `note_connections` referencing the note id.
- Return `{ orphans, total }`. No 500‑item cap; if needed, paginate the connection query in 1000‑row chunks until exhausted.
- Cache with React Query key `["orphan-notes", userId]`.

### 2. Update `OrphanNotesDetector` (compact tile)
- Replace the `useGraphData` + `useNotes` logic with `useOrphanNotes`.
- Count badge and "View all N orphans" now use the same `total`.
- "View all" button navigates to `/dashboard/notes/orphans` (new route) instead of `/dashboard/graph`.
- Keep the per‑item "Find connections" / "Standalone" actions unchanged.

### 3. New page `src/pages/OrphanNotes.tsx` + route
- Route `/dashboard/notes/orphans` in `src/App.tsx`.
- Uses `useOrphanNotes` directly and renders the full list (re‑uses the non‑compact branch of `OrphanNotesDetector` styling) inside `PageLayout` with title "Orphan Notes".
- Each row: note title + preview, click navigates to the note, plus the existing "Find connections" and "Mark standalone" buttons. Hidden‑from‑AI notes are excluded here as well, so the page and tile always agree.
- Empty state: "No orphan notes — everything is connected."

### 4. Graph page (untouched behavior, minor consistency)
- No functional change required. The graph's own orphan toggle keeps working as today.
- Optional: the in‑graph `<OrphanNotesDetector />` (analytics tab) automatically inherits the new behavior because it shares the component.

## Technical notes

- AI‑hidden filter is applied at the DB level (`.eq("ai_visibility", "visible")`) so the count is authoritative and consistent with how AI features treat the notes.
- Using `note_connections` (not `useGraphData`) removes the 500‑node cap, which explains the "5 on tile vs ~20–30 in graph" mismatch.
- "Standalone" dismissal stays client‑side (local `Set`) for now — same as today.

## Files

- **Add** `src/hooks/useOrphanNotes.ts`
- **Add** `src/pages/OrphanNotes.tsx`
- **Edit** `src/components/graph/OrphanNotesDetector.tsx` (use new hook, update navigation target)
- **Edit** `src/App.tsx` (register `/dashboard/notes/orphans` route)
