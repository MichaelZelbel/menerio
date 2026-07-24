## Goal

Each of the three panels (Note Metadata, Links, Backlinks) remembers **the user's own choice** as a global preference:

- Never touched → collapsed on every note (today's expected default).
- User expands it once → stays expanded on every note they open, across reloads.
- User collapses it again → stays collapsed everywhere until they change their mind.

No per-note memory — the preference is per panel, not per note.

## Why the current behavior is wrong

Right now each panel uses local `useState(false)` plus a `useEffect` that force-resets to `false` on every `noteId` change. That both (a) makes the "sticky expand" you want impossible and (b) is fragile enough that a stale render can leave them open — which is what you saw today.

## Fix

### 1. New hook: `src/hooks/useStickyPanelPreference.ts`

- Signature: `useStickyPanelPreference(key: "note-metadata" | "note-links" | "note-backlinks"): [boolean, (v: boolean) => void]`
- Reads/writes `localStorage` under `menerio.panelPrefs.<key>` (safe JSON parse, defaults to `false`).
- SSR-safe (guards `typeof window`).
- Emits a `storage`-like event so multiple mounted instances stay in sync within the same tab.

### 2. Wire it into the three panels

- `src/components/notes/NoteMetadataEditor.tsx` — replace `useState(false)` + `useEffect([noteId])` reset with `useStickyPanelPreference("note-metadata")`.
- `src/components/notes/OutgoingLinksPanel.tsx` — same, key `"note-links"`.
- `src/components/notes/BacklinksPanel.tsx` — same, key `"note-backlinks"`.

Remove the `useEffect(() => setX(false), [noteId])` blocks and the outdated "NoteEditor reuses this instance" comments (NoteEditor actually does remount via `key={selectedNote.id}`).

### 3. Regression test

`src/components/notes/__tests__/panelStickyPreference.test.tsx` (vitest + Testing Library):

- Fresh localStorage → Metadata panel renders collapsed for note A and note B.
- User clicks to expand on note A → localStorage updated → navigating to note B renders expanded.
- User collapses on note B → note A renders collapsed on next open.

## Files touched

- add `src/hooks/useStickyPanelPreference.ts`
- edit `src/components/notes/NoteMetadataEditor.tsx`
- edit `src/components/notes/OutgoingLinksPanel.tsx`
- edit `src/components/notes/BacklinksPanel.tsx`
- add `src/components/notes/__tests__/panelStickyPreference.test.tsx`

No backend, schema, or edge-function changes.
