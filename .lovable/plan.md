## Fix: below-note panels default collapsed on every note open

The screenshot shows a note where **Note Metadata**, **Links**, and **Backlinks** are all expanded on open, pushing the actual note content off-screen. Regression source (verified in code):

- `src/components/notes/BacklinksPanel.tsx` — `useState(true)` (default expanded).
- `src/components/notes/OutgoingLinksPanel.tsx` — `useState(true)` (default expanded).
- `src/components/notes/NoteMetadataEditor.tsx` — persists last-open state in `localStorage` (`menerio-note-metadata-expanded`), so once a user expanded it, every note reopens expanded.

`NoteAttachmentsPanel` and `SuggestedLinksPanel` already default to collapsed. `SmartTagsPanel` is Lexicon-only and unaffected.

### Changes

1. **`BacklinksPanel.tsx`** — change `useState(true)` → `useState(false)`.
2. **`OutgoingLinksPanel.tsx`** — change `useState(true)` → `useState(false)`.
3. **`NoteMetadataEditor.tsx`** — remove the `localStorage`-backed default. Initialize `isOpen` to `false` on every mount and delete the `getStoredExpanded` helper + the `localStorage.setItem` write. Rationale: cross-note persistence is exactly what caused this regression to keep coming back — each note should start with a clean, readable view; the user can expand per-note as needed.

No changes to layout, styling, data, or the panels' expand/collapse interaction — only their initial state on note open.

### Out of scope

- Attachments and Suggested Links panels (already collapsed by default).
- Any redesign of the below-note section or resizable layout.
