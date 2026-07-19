# Unify Collections navigation with People/Notes

Bring Collections into the same "tree + search on the left, detail on the right, AI panel docked" shell that Notes and People already use. Replace the slide-in item overlay with a real routed detail view so the Global AI FAB has stable context for every item.

## Scope decisions (please confirm)

- **Keep the collection-level grid view.** When you land on `/collections/:slug` with no item selected, you still see the grid — it's genuinely better for visual browsing. The shell change is about what happens when you *open* an item.
- **Manual subfolders inside a collection** (item groups) — proposed as **Phase 2**, not v1. Phase 1 gives us the shell, tree, favorites, recents, and routed detail. Subfolders add a new schema + reparenting logic and are worth landing separately once the shell is stable.
- **New-item destination:** force an explicit collection pick when there's no collection context, rather than silently defaulting. Inside a collection, "New item" targets that collection.
- **Item detail is a form, not a rich-text editor.** Fields are dynamic from the collection schema. The "editor-style" framing is about the *shell* (tree left, content right, AI docks), not about Tiptap.

## Phase 1 — Shell, tree, routed detail

### 1. New route + shell

- Add `/collections/:slug/:itemId` alongside the existing `/collections/:slug`.
- New `CollectionsLayout` component modeled on the People layout: `SidebarProvider` with a left `CollectionsTree` panel and `<Outlet />` on the right.
- `/collections` (index) and `/collections/:slug` render inside this shell. Selecting an item navigates to `/collections/:slug/:itemId` and swaps the right pane to `CollectionItemDetail`. No modal, no slide-in.

### 2. `CollectionsTree` (left panel)

Mirrors `PeopleTree`'s structure:

- **Search bar** at top: placeholder "Search collections and items". Searches across collection names, item titles, and item field values (reuse the existing collection search path).
- **Favorites** pinned section — items the user has starred.
- **Recents** pinned section — last N opened items (persisted per-user, same shape as People's `last_viewed_at`).
- **Collections** as top-level nodes; expanding a collection lists its items (paged/virtualized if large). Active item highlighted.
- Right-click / ⋯ menu: open, favorite, delete, move (Phase 2).

### 3. `CollectionItemDetail` (right pane)

- Renders the item title + dynamic fields from the collection schema (reuse whatever `CollectionDetail` currently uses for the slide-in).
- Inline edit, save, delete.
- Breadcrumb: Collections › {Collection name} › {Item title}.
- The Global AI FAB automatically has collection + item context here (see §5).

### 4. Favorites + recents

- Add `is_favorite boolean default false` and `last_viewed_at timestamptz` to `collection_items` (migration + GRANTs).
- `useTouchItemViewed` hook mirrors `useTouchPersonViewed` (5-minute throttle, cache-gated).
- Star toggle in the tree row and in the detail header.

### 5. AI FAB integration

- Extend the route detection in `GlobalAIChatFAB.tsx`: when path matches `/collections/:slug/:itemId`, pass both `collection_id` and `item_id` to `collection-chat`.
- Extend `collection-chat` to accept an optional `item_id` in context and prime the system prompt with the current item's fields (same pattern as note-chat priming the open note).
- Modifying tools (`update_item`, `delete_item`) operate on the open item by default when `item_id` is present.
- Listen for `menerio:collection-updated` on the detail page to refetch after AI edits (already wired at collection level; extend to item level).

### 6. Global "New item" flow

- From inside `/collections/:slug` or `/collections/:slug/:itemId`: creates in the current collection, opens the new item's detail route immediately so you can talk to the AI about it while filling it in.
- From `/collections` (index) or from the global create button with no collection context: opens a small "Choose collection" step, then routes into the new item.
- No silent default — an item created in the wrong collection is worse than one extra click.

### 7. Remove the slide-in

- Delete the item overlay from `CollectionDetail.tsx`. All "open item" call sites navigate to the new route instead.
- Keep the collection-level grid on `/collections/:slug` — it's the landing view when no item is selected.

## Phase 2 — Manual subfolders (item groups)

Deferred, sketched here so we know it fits:

- New table `collection_item_groups` (id, collection_id, parent_group_id, name, user_id) + `collection_item_group_memberships` join table. GRANTs + RLS scoped to owner. Cycle-prevention trigger on `parent_group_id` (reuse People's approach).
- Drag-to-reparent in `CollectionsTree` with the same client-side `wouldCreateCycle` guard we use for People groups.
- Subtree item counts deduped by item id, matching `buildPeopleTree`.
- Item can belong to multiple groups (many-to-many), same as People.

## Technical details

- **Files touched (Phase 1):**
  - New: `src/components/collections/CollectionsLayout.tsx`, `CollectionsTree.tsx`, `CollectionItemDetail.tsx`, `useCollectionsTree.ts`, `useTouchItemViewed.ts`.
  - Modified: `src/App.tsx` (nested routes under `/collections`), `src/pages/CollectionDetail.tsx` (drop overlay, keep grid), `src/pages/Collections.tsx` (render inside shell), `src/components/chat/GlobalAIChatFAB.tsx` (item_id detection), `supabase/functions/collection-chat/index.ts` (accept item_id, prime prompt), `src/components/layout/GlobalCreateButton.tsx` (choose-collection step).
  - Migration: `is_favorite`, `last_viewed_at` on `collection_items` + GRANTs.
- **AI FAB:** the fix we just shipped that resolves collection_id from slug extends naturally — same effect, one more segment.
- **Search:** tree search reuses existing collection/item search; no new indexes needed for Phase 1.
- **Testing:** unit tests for a `buildCollectionsTree` helper (favorites/recents/collections buckets), plus a smoke test that opening an item routes rather than modals.

## Open questions

1. Confirm Phase 2 (subfolders) is deferred, not dropped.
2. On mobile, the shell collapses to a single pane (tree → detail on select), same as People — confirm that's the right behavior.
3. Should "Recents" be per-collection or global across all collections? I'd argue global, matching how you'd actually think ("what did I open last?").
