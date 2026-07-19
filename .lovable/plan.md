
## Goal

Bring the Collections detail page in line with the People page: a left sidebar tree with **Favorites**, **Recent**, **All items**, and user-created **folders** (nestable), plus the editor-style right pane (already in place). Same look and feel as `PeopleTree`, minus the initial-letter avatar chip.

Folders are **real folders** — each item lives in **at most one folder** (or none, in which case it renders loose under "All items"). This matches how humans think about folders and keeps items cleanly mappable to a filesystem path for Obsidian/Git sync down the road.

Also: remove the little colored circle showing the first letter of the name in the People tree — it adds no signal and looks like duplication.

## Data model (new migration)

Collections don't have a folder concept today (`collection_items` has no `is_favorite`, no `last_viewed_at`, no folder linkage). Additions:

1. `public.collection_item_folders`
   - `id`, `user_id`, `collection_id` (FK → collections, cascade)
   - `name text not null`, `parent_folder_id uuid null` (self-FK, `on delete set null` so orphan guard in the builder keeps working)
   - `sort_order int default 0`
   - `created_at`, `updated_at` + trigger
   - Cycle guard trigger mirroring `guard_contact_group_parent_cycle`.
   - GRANTs (authenticated + service_role), RLS: owner-only via `auth.uid() = user_id`.

2. Alter `public.collection_items`:
   - add `folder_id uuid null` — FK → `collection_item_folders(id)` `on delete set null`. Nullable = "loose, at root".
   - add `is_favorite boolean not null default false`
   - add `last_viewed_at timestamptz null`
   - CHECK (via trigger, since we need `collection_id` comparison): `folder_id`'s `collection_id` must equal the item's `collection_id` — a folder from one collection can't hold items from another.

No membership table. No many-to-many.

## Frontend

### New: `src/components/collections/CollectionItemsTree.tsx` + `collectionItemsTreeBuild.ts`

Ported from `PeopleTree.tsx` / `peopleTreeBuild.ts`, adapted for single-parent folders:

- **Favorites** — items with `is_favorite = true`, alpha by title.
- **Recent** — top 15 by `last_viewed_at desc`; stamped when the user opens an item.
- **All items** — folders first (nested; `subtreeCount` = plain sum of descendant item counts, since single-parent means no dedupe), then items with `folder_id = null` at depth 1.
- **Search** — flat filtered list when a query is present.

Row rendering:
- Folder rows: chevron + folder icon + name + count. Context menu: New subfolder, New item here, Rename, Delete (only when empty — otherwise offer "Delete and move items to parent").
- Item rows: **no letter chip**, just the title, favorite star on hover, drag handle. Context menu: Open, Favorite, Move to folder…, Remove from folder (only shown when it has one), Delete.
- Drag/drop:
  - Item → folder: sets `folder_id`.
  - Item → "All items" root: sets `folder_id = null`.
  - Folder → folder: reparent (cycle-guarded client-side via `wouldCreateCycle`, DB trigger is the backstop).
  - Folder → "All items" root: `parent_folder_id = null`.

Auto-expand ancestors of the selected item; keyboard nav flattener mirrors the People tree.

### `src/pages/CollectionDetail.tsx`

Replace the current flat sidebar list with `CollectionItemsTree`. Load folders alongside items in parallel; the right editor pane (`ItemSheet` inline mode) is unchanged.

Handlers:
- `onSelectItem(id)` → navigate to `/collections/:slug/:itemId` and fire-and-forget update `last_viewed_at`.
- `onToggleFavorite(id, next)` → update `collection_items.is_favorite`.
- `onCreateFolder(parentId | null)`, `onRenameFolder`, `onDeleteFolder`, `onReparentFolder`.
- `onMoveItemToFolder(itemId, folderId | null)`, `onCreateItem(folderId | null)`, `onDeleteItem`.

### People tree tweak

In `src/components/people/PeopleTree.tsx`, delete the initial-letter `<span>` avatar in `PersonRow` (and its `initial` derivation). No other changes to People.

### Types

Regenerate Supabase types after the migration; then wire them into `CollectionDetail.tsx` and the new tree files.

## Out of scope

- No changes to `Collections.tsx` (the index page).
- No AI/backend changes; `collection-chat` already receives the selected item via context.
- Obsidian/Git export of the folder path isn't part of this task — the schema just doesn't preclude it.

## Files touched

```text
supabase/migrations/<new>.sql                                    (new: folders table + item columns + cycle & cross-collection guards)
src/components/collections/CollectionItemsTree.tsx               (new)
src/components/collections/collectionItemsTreeBuild.ts           (new)
src/pages/CollectionDetail.tsx                                   (wire tree in, drop old sidebar list, stamp last_viewed_at)
src/components/people/PeopleTree.tsx                             (remove initial-letter chip)
```
