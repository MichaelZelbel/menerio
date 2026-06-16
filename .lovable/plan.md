## Root cause

`src/App.tsx` declares two sibling routes that both render `<Notes />`:

```tsx
<Route path="notes" element={<Notes />} />
<Route path="notes/:noteId" element={<Notes />} />
```

These are distinct element instances. Navigating between `/dashboard/notes` and `/dashboard/notes/<id>` switches matches, which unmounts the first `<Notes />` and mounts a second. Every hook resets, every query refetches, the tree re-expands from scratch and TipTap rebuilds — the visible "flash and re-render" the user reports. Happens on every selection, on any viewport. Independent of the recent mobile work.

## Fix

Collapse the two routes into one shared element so React Router keeps `<Notes />` mounted across selection changes.

### 1. `src/App.tsx`

Replace the two route lines with a single splat route:

```tsx
<Route path="notes/*" element={<Notes />} />
```

A splat route matches both `/dashboard/notes` and `/dashboard/notes/<id>` with the same element instance, so `<Notes />` stays mounted as `:noteId` changes.

### 2. `src/pages/Notes.tsx`

The component currently reads `noteId` via `useParams<{ noteId?: string }>()`. With the splat route, `useParams()['*']` holds the rest of the path. Replace:

```tsx
const { noteId: urlNoteId } = useParams<{ noteId?: string }>();
```

with:

```tsx
const params = useParams();
const urlNoteId = params["*"] || undefined;
```

Everything else (the `useEffect` that syncs `selectedId` from `urlNoteId`, the `selectNote → navigate(...)` calls) stays unchanged.

No other call sites use `useParams` for this noteId.

## Verification

- Click between several notes on desktop: tree state stays put, no flash, editor swaps in instantly (only the editor remounts via its `key={selectedNote.id}`, which is intentional).
- Deep-link to `/dashboard/notes/<id>` loads the editor with that note.
- Deep-link to `/dashboard/notes` loads with no selection.
- Mobile behavior from the previous step still works (list ↔ editor switch via back button).
- `bunx tsc --noEmit` clean.

## Out of scope

The `useIsMobile()` first-render flip and the editor wrapper structure are not the cause and don't need changing for this bug. If they cause other issues later, address separately.
