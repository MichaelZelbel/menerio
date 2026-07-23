## Problem

When switching between notes, the **Note Metadata**, **Outgoing Links**, and **Backlinks** panels appear expanded even though each one's local state defaults to `useState(false)`. The `NoteEditor` re-renders with a new `noteId` prop but React reuses the same panel component instances, so whatever `expanded` state the user (or a previous note) left them in persists.

Yesterday's attempted fix used `key={noteId}` to force remounts, but that turned out to cause the "panels rendered multiple times stacked" glitch and was reverted — leaving no reset mechanism at all. Hence the regression.

## Fix (survives because it doesn't rely on remounting)

Reset the local `expanded` / `isOpen` state to `false` inside each panel whenever the `noteId` prop changes, using a `useEffect`. No key props, no remounts, no duplication risk.

Files to change (one small hook added to each):

1. `src/components/notes/BacklinksPanel.tsx` — add
   ```ts
   useEffect(() => { setExpanded(false); }, [noteId]);
   ```
2. `src/components/notes/OutgoingLinksPanel.tsx` — same reset on `noteId`.
3. `src/components/notes/NoteMetadataEditor.tsx` — same reset on the note identity it receives (needs to accept/derive a `noteId` — pass it from `NoteEditor` as a new prop so the effect has a stable dependency; the metadata object reference alone is unreliable).

## Regression guards

- Add a small test (or extend an existing one) in `src/components/notes/__tests__/` that renders a panel with `noteId="a"`, sets `expanded=true`, rerenders with `noteId="b"`, and asserts the panel is collapsed again.
- Leave a short comment in each panel explaining *why* the effect exists so a future refactor doesn't silently drop it.

## Out of scope

No changes to `NoteEditor.tsx` layout, no `key` props reintroduced, no changes to the reverted duplication fix.