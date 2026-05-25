## Add "Make a copy" to note context menu

Add an Obsidian-style note duplication action to the right-click context menu on notes in the sidebar tree.

### Behavior

- Right-click any non-trashed note in the tree → new menu item **"Make a copy"** (between *Copy link* and *Move to…*).
- Duplicates the note with:
  - Same `content`, `tags`, `folder_path`, `structured_fields`, `entity_type`.
  - New `title` derived from the original using Obsidian's convention: append ` 1`, and if that already exists in the same folder, increment (` 2`, ` 3`, …).
  - Fresh `id`, `created_at`, `updated_at`; `is_pinned=false`, `is_favorite=false`, `is_trashed=false`.
  - `metadata.duplicated_from = <original id>` so the origin is traceable; `source_app/source_id/source_url` cleared (the copy is a native local note, not a synced external one).
- After creation: toast "Duplicated note", select the new note, and navigate to `/dashboard/notes/<new-id>`.

### Title suffix rule (matches Obsidian)

```text
"Meeting notes"      → "Meeting notes 1"
"Meeting notes 1"    → "Meeting notes 2"
"Report v3"          → "Report v3 1"   (only trailing " N" is treated as a counter)
```

Collision check is scoped to the same `folder_path` and the current user's non-trashed notes.

### Files to change

1. **`src/hooks/useNotes.ts`** — add `useDuplicateNote()` mutation:
   - Fetch the source note row.
   - Query sibling titles in the same folder via `notes` table to compute the next free suffix.
   - Insert the new note; invalidate `["notes"]`.
2. **`src/components/notes/NoteTree.tsx`** — add a new `ContextMenuItem` "Make a copy" (with `Copy` icon from lucide-react) in the non-trashed branch of the note context menu. On click: call the duplicate mutation, then `onSelectNote(newId)` and `navigate(\`/dashboard/notes/${newId}\`)`.
3. **`src/pages/Notes.tsx`** (only if NoteTree needs the handler wired through props) — pass an `onDuplicateNote` callback. If NoteTree can use the hook directly (it already uses other hooks), skip prop drilling and call the hook inside NoteTree.

### Out of scope

- No bulk-duplicate from `BulkActionBar` (can be added later if requested).
- No duplication for external/synced notes' source metadata — copies are always native local notes (consistent with existing "Duplicate to edit" pattern in `NoteEditor.tsx`).
- No DB migration; uses existing `notes` table.
