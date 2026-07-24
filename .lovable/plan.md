# Fix: popped-out note window shows stale content for minutes

## Root cause (confirmed by reading the code)

Each browser window runs its own React Query cache in memory, but they share the on-disk cache in IndexedDB via `queryPersister` (`src/lib/query-persister.ts`, wired in `src/App.tsx:73-88`). The defaults are:

- `staleTime: 5 * 60 * 1000` (5 minutes)
- `refetchOnWindowFocus: false`
- `networkMode: "offlineFirst"`
- `persister: queryPersister.persisterFn`

When you pop a note out with `window.open('/dashboard/notes/:id', '_blank')` (`src/components/notes/NoteEditor.tsx:1116`), the new window:

1. Hydrates the notes list / note detail query from IndexedDB (the version written by the *previous* save, or an even older one).
2. Sees the query as "fresh" (< 5 min old) and does not refetch.
3. Because `refetchOnWindowFocus` is off and there is no cross-window invalidation, edits made in window A never reach window B until the 5-minute stale timer expires.

Meanwhile window A shows the new version after a manual reload because its own in-memory cache was just updated by the save mutation, and reload repopulates from that same recent write.

The "few minutes" delay the user describes matches the 5-minute `staleTime` exactly.

## Fix

Add cross-window cache synchronization so a save in one window immediately invalidates the affected queries in every other window of the same app.

### 1. New module: `src/lib/query-sync.ts`

- Create a `BroadcastChannel("menerio-query-sync")` (fallback: `storage` event on `localStorage` for Safari private mode).
- Export `broadcastInvalidation(keys: unknown[][])` — posts `{type: "invalidate", keys, ts}`.
- Export `installQuerySyncListener(queryClient)` — on message, calls `queryClient.invalidateQueries({queryKey})` for each key and also removes the matching entries from the IndexedDB persister so a follow-up reload can't resurrect the stale copy.

### 2. Wire the listener once at app boot

In `src/App.tsx` near the `QueryClient` creation, call `installQuerySyncListener(queryClient)` inside a `useEffect` in a small `<QuerySyncBridge/>` component mounted under `QueryClientProvider`.

### 3. Broadcast on note writes

In `src/hooks/useNotes.ts`, wherever we currently call `qc.invalidateQueries({ queryKey: ["notes"] })` after a successful save / update / delete (lines ~213, 275, 299, 413), also call `broadcastInvalidation([["notes"], ["note", id]])`. Same treatment for the single-note detail hook if it uses a different key.

### 4. Belt-and-suspenders for the note detail route

In the note detail query (the one that powers `/dashboard/notes/:id`), set `refetchOnMount: "always"` so a freshly opened window always revalidates against Supabase on top of the broadcast mechanism. This is scoped to that one query, not global, so we don't churn other screens.

### 5. Don't leave stale data in IndexedDB

When we broadcast an invalidation, also remove the persisted entry for the affected keys via `queryPersister.persisterFn`'s storage layer (already exposed in `src/lib/query-persister.ts`). This prevents the next cold reload of the popped-out window from painting the old note before the refetch finishes.

## Out of scope

- No change to `staleTime` globally — reducing it would cause extra refetches everywhere.
- No change to the pop-out mechanism itself (`window.open`).
- No Supabase realtime subscriptions (heavier; the broadcast + refetch-on-mount is enough for the same-user, same-browser case the user described).

## Verification

- Manual: edit a note, pop it out, confirm the new window renders the current version immediately (and after hard reload).
- Automated: add a small vitest around `query-sync.ts` (message round-trip triggers `invalidateQueries` with the expected keys).