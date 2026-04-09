

## Fix: Clicking Search Results Now Opens the Note

### Problem
The **DashboardSearch** (header search bar, ⌘K) navigates to `/dashboard/notes?note=<id>` when you click a result. But the Notes page reads the note ID from the **URL path** (`/dashboard/notes/:noteId`), not from the `?note=` query parameter. So the query param is silently ignored and nothing happens.

### Fix
**File: `src/components/layout/DashboardSearch.tsx`** (line 70)

Change the navigation from:
```
navigate(`/dashboard/notes?note=${noteId}`)
```
to:
```
navigate(`/dashboard/notes/${noteId}`)
```

This matches the route pattern `/dashboard/notes/:noteId` defined in `App.tsx` (line 101), which the Notes page already handles correctly via `useParams`.

### That's it
One line change. The in-page search within the Notes page already works correctly (it uses the right URL pattern). This fix only affects the global header search bar.

