## Bug

The "Sort notes" dropdown on the All Notes page (sort by Created / Updated / Title, asc/desc) appears to do nothing. Confirmed by reading the code.

## Root cause

`src/pages/Notes.tsx` correctly sorts `currentNotes` by the user's selected field/direction. But when the user is *not* in search mode, that array is rendered by `<NoteTree>` (not `<NoteList>`), and `NoteTree` builds its own folder tree and **re-sorts notes alphabetically by title** inside `sortFolder()` (`src/components/notes/NoteTree.tsx` lines 68–77). The page-level sort gets thrown away.

`<NoteList>` (used only in search mode) does respect the page-level order, which is why sort "works" while searching but not in the normal All Notes view.

## Fix

Pass the chosen sort to `NoteTree` and use it instead of the hard-coded title sort. Folder names stay alphabetical (folders aren't notes — sorting them by "created" makes no sense).

### Change 1 — `src/components/notes/NoteTree.tsx`

- Export `NoteTreeSortField = "updated_at" | "created_at" | "title"` and `NoteTreeSortDirection = "asc" | "desc"`.
- Add optional `sortField` (default `"updated_at"`) and `sortDirection` (default `"desc"`) to `NoteTreeProps`.
- Replace the body of `sortFolder` so notes use those values:

```ts
function sortNotesArray(notes, sortField, sortDirection) {
  const dir = sortDirection === "asc" ? 1 : -1;
  return notes.sort((a, b) => {
    const aPinned = a.is_pinned ? 1 : 0;
    const bPinned = b.is_pinned ? 1 : 0;
    if (aPinned !== bPinned) return bPinned - aPinned; // pinned always first

    if (sortField === "title") {
      return dir * (a.title || "Untitled").localeCompare(b.title || "Untitled");
    }
    // created_at / updated_at — ISO strings sort chronologically as strings,
    // but use Date for safety against nulls.
    const aTs = a[sortField] ? new Date(a[sortField]).getTime() : 0;
    const bTs = b[sortField] ? new Date(b[sortField]).getTime() : 0;
    return dir * (aTs - bTs);
  });
}
```

- Pipe `sortField` / `sortDirection` through `sortFolder()` recursively.
- Add them to the `useMemo` dependency array so the tree re-builds when sort changes.

### Change 2 — `src/pages/Notes.tsx`

- Forward the existing `sortField` and `sortDirection` state to `<NoteTree>` (around line 818).

### Side cleanup (small)

In `Notes.tsx` `currentNotes` (line 312–324) the comparator does `(a[sortField] || "").localeCompare(...)` for date fields. That's still string-correct for ISO timestamps but brittle if a value is ever `null`. Switch to the same `Date.getTime()` comparison used in `NoteTree` so both paths stay identical.

## Out of scope

- The 1000-row server limit in `useNotes.ts` (`.order("updated_at", { ascending: false })` then implicit limit). Not the cause of the visible bug. If a user has more than 1000 notes the oldest ones won't appear regardless of sort — separate issue, can be addressed later with pagination or a server-side sort param.
- No changes to the dropdown UI or state.
