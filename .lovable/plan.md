

## Current State

Notes are ordered by **pinned first**, then **last edited (newest first)**. There is no UI to change sort order.

## Plan: Add Sort Options to Notes List

### Sort Options
- **Last Edited** (updated_at) — ascending / descending
- **Date Created** (created_at) — ascending / descending  
- **Title** (alphabetical) — A-Z / Z-A

Pinned notes always stay at the top regardless of sort choice.

### Changes

**1. `src/pages/Notes.tsx`**
- Add state: `sortField` (`"updated_at" | "created_at" | "title"`) defaulting to `"updated_at"`, and `sortDirection` (`"asc" | "desc"`) defaulting to `"desc"`.
- In the `currentNotes` useMemo, after filtering, sort client-side based on the selected field and direction (pinned notes remain first).
- Add a sort dropdown button in the toolbar area (next to the existing filter/search controls). Use `ArrowUpDown` or `SortAsc`/`SortDesc` icon from lucide. The dropdown shows the three sort fields, each with an asc/desc toggle. Active sort gets a checkmark.

**2. `src/hooks/useNotes.ts`**
- No changes needed — keep the default DB ordering as-is. Client-side re-sorting in the page is sufficient since all notes are already fetched.

**3. UI Design**
- Small dropdown button labeled with current sort (e.g. "Last Edited ↓") placed in the notes list header bar, next to the filter dropdown.
- Clicking the already-active sort field toggles direction. Clicking a different field selects it with its default direction.

### Files Modified
- `src/pages/Notes.tsx` — add sort state, sort logic, and sort dropdown UI

