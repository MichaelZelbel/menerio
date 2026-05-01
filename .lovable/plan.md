## Goal

Replace the inline Markdown textarea with a proper note workflow: link an **existing** note or create a **new** note that opens the real Notes editor — same UX as everywhere else in the app.

## Behavior (revised)

In the item editor sheet, the "Notes" section becomes a list with two actions:

- **+ New note** → creates an empty note (via `useCreateNote`) tagged with `metadata.collection_item_id` + `metadata.collection_id`, then navigates to `/notes/:id` (the full Notes editor with TipTap, attachments, AI, etc.). The item sheet closes.
- **Link existing note** → opens a popover with search (by title) over the user's notes. Picking one writes the metadata onto that note and refreshes the list.

The list shows each linked note with title, snippet, last-updated. Row actions:
- Click row → navigate to `/notes/:id` (open in real editor).
- ⋯ menu → "Unlink from item" (clears metadata; note stays in vault) or "Delete note" (soft trash).

No more inline textarea, no more inline Markdown editing — notes are always edited in the Notes app.

## Files

- `src/pages/CollectionDetail.tsx` — rewrite `ItemNotesPanel`:
  - Drop the expand-to-edit textarea/title input and `saveNote` logic.
  - Keep `load`/`unlinkNote`/`deleteNote`.
  - `createNote` → use `useCreateNote().mutateAsync({ title: itemTitle, content: "", metadata: {...} })` then `navigate('/notes/' + note.id)` and close the sheet.
  - Add a "Link existing note" popover using `supabase.from('notes').select(...).ilike('title', '%query%')` (limit 20, exclude already-linked, exclude trashed). On pick → update that note's metadata.
  - List rows are clickable → navigate to `/notes/:id`.

## Notes

- Storage approach unchanged (metadata-based, no migration).
- Closing the item sheet on "+ New note" is needed because the Notes editor is a full page — leaving the sheet open behind it would be confusing.
