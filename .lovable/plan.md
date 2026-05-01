## Goal

Yes — items can already be linked to notes via a `link_note` schema field, but that only points to ONE existing note and requires schema setup. The user wants a **native, always-available freeform notes area** on every collection item — a place to jot unstructured info alongside the structured fields.

## What exists today

- Schema field type `link_note` lets the user manually add a "Link to Note" field to a collection. They then pick one existing note from a popover.
- This is hidden, requires schema editing, and only links to a pre-existing note.

## Proposed solution

Add a built-in **Notes section** to the item editor sheet (`ItemSheet` in `src/pages/CollectionDetail.tsx`). Every item gets it — no schema setup needed.

### Behavior

- Below the structured fields in the item editor, show a "Notes" section.
- Lists notes already linked to this item (in chronological order, newest first).
- "+ Add note" button → creates a new note, prefilled with item title as note title, and links it to the item. Opens inline Markdown editor (small TipTap or simple textarea — see decision below).
- "Link existing note" secondary action → opens the same picker the `link_note` field uses.
- Each linked note row shows: title, snippet, last-updated, with actions: open in Notes app (`/notes/:id`), unlink, delete note.
- Notes created here are real notes — they appear in the Notes app, knowledge graph, search, etc.

### Data model

No schema changes needed. We reuse the existing `note_connections` table:
- `connection_type = 'collection_item'`
- `source_note_id = note.id`
- `target_note_id` is uuid-typed, so we can't store a collection_item id there directly without a migration.

**Two options** (asking below):

**Option A — Use note metadata** (no migration)
Store the item link in `notes.metadata.collection_item_id` and `notes.metadata.collection_id`. Query by JSON filter. Simplest, no schema change.

**Option B — New table** `collection_item_notes(id, user_id, item_id, note_id, created_at)` with RLS. Cleaner relational model, supports many-to-many properly, easier indexing.

I recommend **Option A** for speed and simplicity — a collection item "owns" its notes via metadata, similar to how groups/people relate to notes already.

### UI changes

- `src/pages/CollectionDetail.tsx` — `ItemSheet` component:
  - New `<NotesPanel itemId=... collectionId=... />` section under the structured fields.
  - Loads notes where `metadata->>'collection_item_id' = itemId`.
  - "Add note" creates a note via `supabase.from('notes').insert({...})` with metadata set, then refreshes.
  - Inline expand/collapse to edit a note without leaving the sheet (simple textarea editing `content` as Markdown — keeping with the project's Obsidian-Markdown-native rule).
- "Open in Notes" deep-links to `/notes/:id` (existing route).
- When an item is deleted, optionally orphan the notes (don't auto-delete) — show a small confirmation: "X notes are linked. They will remain in your Notes app."

### Out of scope

- No bidirectional schema field needed — this replaces the manual `link_note` workflow for the common case.
- Not changing how `link_note` schema fields work; they remain for users who want a structured single-link field.

## Files to touch

- `src/pages/CollectionDetail.tsx` — add NotesPanel inside ItemSheet, add helpers to fetch/create/unlink notes.
- `mem://features/collections-editing` — note the new built-in notes affordance.

## Question for you

Which storage approach do you prefer?
