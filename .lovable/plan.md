## Goal

In the notes sidebar, currently the tree has a single root **"Vault root"**. Add three more sibling roots, all **collapsed by default**:

- **⭐ Favorites** — all starred notes (flat list)
- **🕘 Recent** — 20 most recently updated notes (flat list)
- **🗑 Trash** — all trashed notes (flat list)

## Feasibility

Easy and cheap. All data is already loaded by `useNotes` hooks in `src/pages/Notes.tsx`:

- `allNotes` (excludes trash) → source for Recent
- `favNotes` → source for Favorites
- `trashNotes` → source for Trash

No new queries, no schema change, no extra network calls. Rendering ~20 extra rows when expanded has zero perceptible perf impact. The existing top filter chips ("All / Favorites / Trash") can stay — the new roots are a parallel, always-visible navigation aid in the tree.

## Changes

### `src/pages/Notes.tsx`
- Pass two new props to `<NoteTree>`:
  - `favoriteNotes={favNotes}`
  - `trashedNotes={trashNotes}`
- `recentNotes` is derived inside `NoteTree` from `notes` (top 20 by `updated_at`) so we don't double-compute.

### `src/components/notes/NoteTree.tsx`
- Add optional props `favoriteNotes`, `trashedNotes`.
- Replace the single `<FolderRow node={tree} />` render with a wrapper that renders four siblings in order:
  1. `Vault root` (existing tree, expanded by default — unchanged behavior)
  2. `Favorites` (virtual root, collapsed by default)
  3. `Recent` (virtual root, collapsed by default)
  4. `Trash` (virtual root, collapsed by default)
- Implement virtual roots as a lightweight `VirtualRootRow` component (or reuse `FolderRow` with a `variant: "virtual"` flag) that:
  - Shows chevron + icon (Star / Clock / Trash2) + label + count badge
  - When expanded, renders `NoteRow`s for the supplied notes — no nested folders, no drag/drop targets, no "New note here" context menu
  - Uses stable expand keys: `__favorites__`, `__recent__`, `__trash__` (NOT added to default `expanded` set, so they start collapsed)
- For the Trash root, `NoteRow` already supports `onRestoreNote` / `onDeleteNotePermanently` context-menu actions — pass them through.
- For Favorites and Recent, the standard note context menu works as-is.
- Selection: clicking a note in any virtual root calls existing `onSelectNote`; it opens the same editor. No change to routing.
- Sorting inside virtual roots:
  - Favorites: respect the current `sortField`/`sortDirection`
  - Recent: always `updated_at desc`, capped at 20
  - Trash: `trashed_at desc` (fallback `updated_at desc`)

### Auto-expand behavior
The existing effect auto-expands ancestors of the selected note. Extend it: if the selected note is trashed → auto-expand `__trash__`; if favorite and not in Vault → auto-expand `__favorites__`. Otherwise leave virtual roots collapsed (user preference is preserved per session via the existing `expanded` state).

### No drag & drop on virtual roots
Virtual roots are not real folders. Dropping a note onto Favorites/Recent/Trash is a no-op in this iteration (could later mean "star it" / "trash it" but out of scope here).

## Out of scope
- Persisting expand state across reloads
- Pinned-notes root
- Allowing drop on Trash to delete
- Changing the existing top filter chips

## Risks
None significant. Counts and lists update reactively via React Query just like today.
