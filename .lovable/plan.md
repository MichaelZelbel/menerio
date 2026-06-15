## Remove the "All Notes / Favorites / Trash" filter dropdown

Now that the sidebar tree has dedicated **Favorites**, **Recent**, **Vault root**, and **Trash** roots, the top-of-panel filter dropdown is redundant. Remove it and always show "All Notes" in the middle panel list.

### Changes in `src/pages/Notes.tsx`

1. **Remove the dropdown UI** (lines ~751-775) — the `<DropdownMenu>` with `activeFilter` and `filterConfig`. Replace it with a simple static header label ("All Notes" with its icon and total count) to keep the panel header visually balanced next to the Filter-by-type button and the search/sort controls.

2. **Hard-code the filter to "all"** — remove the `filter` state (or initialize it to `"all"` and never change it). All list-filtering logic that depends on `filter` (favorites/trash branches) collapses to the "all" branch, which already excludes trashed notes.

3. **Remove now-unused code**:
   - `filterConfig` array
   - `activeFilter` derivation
   - `setFilter` calls
   - `ChevronDown` import if no longer used elsewhere
   - `counts.favorites` / `counts.trash` if only consumed by the dropdown (keep `counts.all` for the header label)

4. **Navigation behavior** — selecting a note from the **Trash** or **Favorites** tree root still opens the editor correctly (that path doesn't depend on the middle-panel list). The middle panel simply continues to show "All Notes" (non-trashed); the tree is the source of truth for finding favorited/trashed notes. This matches option 2 from the previous discussion.

### Out of scope

- No changes to `NoteTree.tsx` — virtual roots stay as-is.
- No changes to search behavior (the `searchMode` branch is independent).
- No changes to the entity-type Filter button next to the dropdown.

### Verification

- `bunx tsc --noEmit` should be clean.
- Visually confirm the panel header still looks balanced and that clicking a trashed/favorited note from the tree opens it in the editor.
