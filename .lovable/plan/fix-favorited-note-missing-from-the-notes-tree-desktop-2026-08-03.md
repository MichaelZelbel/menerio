# Fix: favorited note missing from the Notes tree (desktop)

## What is confirmed

- The note "Michael's Discord Status Log" (`3e24bedb…`) is correct on the server: `is_favorite = true`, `is_trashed = false`, `updated_at = 2026-08-03`. The account has 289 active notes and 7 favorites, which matches what the tree shows now.
- The screenshot is the desktop app (Tauri). On desktop the local-first path is always on (`IS_DESKTOP` forces `OFFLINE_CORE`), so the **tree reads from the local SQLite replica** (PowerSync), not from Supabase.
- The **open note in the editor does not come from that same local list**. `Notes.tsx` resolves the open note from the list *or* from search results, and search (semantic search especially) hits the server directly. So a note that is missing or stale in the local replica can still be opened and shown as starred in the editor while being absent from Favorites and Recent in the tree.

That asymmetry — server-fresh editor vs. local-replica tree — is exactly the symptom reported. What is **not** yet confirmed is *why* the row was missing locally: either the local replica never received/updated that row (sync stalled, upload queue wedged, or the row arrived after the snapshot), or it was present but stale. There is no way to inspect the desktop's SQLite from here, so verification has to be the first step and has to run on the device.

## Plan

### 1. Add a sync self-check (diagnosis + permanent value)

Extend the Sync section in Settings with a "Local replica" panel that shows, on desktop:

- local note count vs. server note count (and local favorites vs. server favorites),
- PowerSync connection state, last completed sync time, and pending upload-queue size,
- a list of ids present on the server but missing locally (capped), so a gap names the exact rows.

This turns the current guesswork into a one-click answer the next time something is missing, and it will confirm or rule out the "row missing locally" cause immediately.

### 2. Make the tree self-heal instead of silently hiding notes

- When a note is opened that is **not** in the local replica (the case that produced this report), write it into local SQLite so it immediately appears in the tree, and log it to the sync panel as a reconciliation event.
- Add a "Repair local copy" action to the sync panel that pulls the full note set from Supabase and upserts it into SQLite, without wiping local pending writes.

### 3. Close the freshness gap for the open note on desktop

`useNote` is disabled when the local-first path is on, so the editor relies on the list/search copy. Enable the single-row server fetch on desktop as well when online, and keep the existing "newest `updated_at` wins" merge. That guarantees the editor and tree converge on the same row instead of drifting.

### 4. Make favorites/recent consistent with the active filters

Favorites in the tree come from a separate query while Recent is derived from the filtered list, so an entity/topic/person filter can hide a note from one section but not the other. Derive both from the same source so a note can never disappear from just one of them.

## Technical notes

- Files: `src/pages/Notes.tsx` (selected-note resolution, filter sources), `src/hooks/useNotes.ts` (enable `useNote` on desktop, local upsert helper), `src/components/notes/NoteTree.tsx` (favorites/recent source), `src/components/settings/SyncDashboard.tsx` (replica panel), `src/sync/db.ts` (repair/upsert helpers).
- No database migration and no change to the PowerSync sync rules is needed; the rules already select every column the client schema declares.
- Step 1 ships first so the next occurrence is diagnosable even if steps 2–4 turn out to cover the cause completely.
