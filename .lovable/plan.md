## Goal

Make moving notes in the Notes Tree work consistently for:
- Querino-synced (external) notes — currently silently undraggable.
- Multi-selected notes — currently entire tree becomes undraggable, and drop only handles a single id.

## Changes — `src/components/notes/NoteTree.tsx`

### 1. Allow dragging external notes
Remove the `!note.is_external` guard on the note row.
- `draggable={!multiActive || isMultiSelected}` instead of `draggable={!note.is_external && !multiActive}`
- Drop the matching cursor-class condition so the grab cursor shows for synced notes too.

Rationale: `receive-note` already preserves `folder_path` on UPDATE (per recent change), so a manual move on a Querino note is durable.

### 2. Support bulk drag-and-drop
- Make a row draggable when it is part of the active selection (so the user can grab any of the selected rows to move all of them).
- On `onDragStart` of a multi-selected row, write the full id list as a JSON payload, e.g. `event.dataTransfer.setData("application/x-note-ids", JSON.stringify(selectedIds))`, in addition to the existing single `text/plain` id (kept for backward compatibility / single-row drag).
- Extend `handleDrop` to read `application/x-note-ids` first; if present, call `onMoveNote` for each id (the existing handler accepts `(noteId, path)` and `useUpdateNote` is mutation-safe to call in a loop). Fall back to the single-id path otherwise.

### 3. Multi-select context menu Move
When the right-clicked note is part of the current selection (`bulk.isSelected(note.id)` and `bulk.size > 1`), the "Move to" submenu should move the entire selection, not just one row. Implementation: in the submenu's `onClick` handlers, if the selection contains the note, iterate over `selectedIds` calling `onMoveNote`; otherwise keep the single-id behavior.

### 4. Visual feedback for no-op moves (optional, small)
`handleMoveNote` in `src/pages/Notes.tsx` currently always shows a "Moved to …" toast even when the source folder equals the target. Skip the mutation if `note.folder_path === folderPath` to avoid the misleading "moved" feedback that the user just experienced. (Trivial guard, no behavior change for real moves.)

## Out of scope
- No DB / RLS changes — current policies already permit the update.
- No changes to `BulkActionBar` UI — the existing folder text input continues to work and will benefit from issue #1 transparently.
- No changes to GitHub/Querino sync logic.

## Verification
- Drag a Querino prompt onto another folder → row moves, persists across reload, and the next Querino sync does not snap it back (receive-note preserves folder_path on UPDATE).
- Cmd/Ctrl-click 3 prompts, drag one of them onto a folder → all three move.
- Right-click within a selection → "Move to" moves all selected notes.
- Right-click on a row in its current folder and pick the same folder → no toast, no DB write.
