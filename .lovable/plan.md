
## Open Notes in Separate Tabs

### Current state
Routes already exist: `/dashboard/notes/:noteId` loads the Notes page and auto-selects the note. So opening a note URL in a new tab already works.

### What's missing
There's no UI affordance to open a note in a new tab. Users would need to manually copy the URL.

### Plan

**1. Add "Open in new tab" option to NoteList items** (`src/components/notes/NoteList.tsx`)
- Add a right-click context menu (or a small icon button) on each note item with an "Open in new tab" option
- Use `window.open(\`/dashboard/notes/\${note.id}\`, '_blank')` to open in a new browser tab
- Alternatively, wrap note titles in `<a href="/dashboard/notes/${note.id}">` links so users can naturally right-click → "Open in new tab" or Ctrl/Cmd+click

**2. Add "Open in new tab" to NoteEditor toolbar** (`src/components/notes/NoteEditor.tsx`)
- Add a small external-link icon button in the editor header that opens the current note in a new tab

### Recommended approach
The simplest and most native approach: render each note list item as an `<a>` tag with the proper href. This gives users standard browser behavior (right-click menu, Ctrl+click, middle-click) for free, with no extra UI needed. The `onClick` handler would call `e.preventDefault()` for normal clicks to keep the current SPA navigation behavior.

### Files to change
- `src/components/notes/NoteList.tsx` — wrap note items in `<a href>` tags
- `src/components/notes/NoteEditor.tsx` — add "Open in new tab" icon button in the header
