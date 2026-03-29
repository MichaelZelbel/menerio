

## Direct Note Links

Currently, the Notes page lives at `/dashboard/notes` with note selection managed entirely via React state (`selectedId`). There are no URL-based note links — refreshing the page or sharing a URL loses the selected note.

### Approach

Use the URL to encode the selected note, so every note gets a stable, copyable link like:

```
/dashboard/notes/abc-123-uuid
```

### Changes

**1. Add a route for individual notes** (`App.tsx`)
- Add `<Route path="notes/:noteId" element={<Notes />} />` alongside the existing `notes` route.

**2. Sync `selectedId` with URL** (`Notes.tsx`)
- Read `noteId` from `useParams()` on mount and set it as the selected note.
- When the user selects a note, call `navigate(`/dashboard/notes/${id}`, { replace: true })` instead of just `setSelectedId`.
- When deselecting (e.g., note deleted), navigate back to `/dashboard/notes`.

**3. Add a "Copy link" button** (`NoteEditor.tsx`)
- Add a small link/copy icon in the note editor toolbar.
- On click, copy the full URL (`window.location.origin + /dashboard/notes/${note.id}`) to clipboard with a toast confirmation.

**4. Copy link in note list context menu** (`NoteList.tsx`)
- Add a "Copy link" option to the right-click or overflow menu on each note item in the list.

### Result
- Every note has a stable, bookmarkable URL.
- Users can copy and paste note links in Slack, emails, docs, etc.
- Refreshing the page preserves the selected note.
- Deep links from notifications, weekly reviews, and action items will also work naturally.

