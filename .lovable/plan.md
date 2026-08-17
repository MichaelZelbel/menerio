# Fix: endless "Saving…" and a folder that never shows up in the tree

## What I could and could not verify

Verified in code:

- The note autosave sets the status to "Saving…" on every keystroke and only clears it when the write **resolves**. If the request neither succeeds nor errors (a hung connection), the indicator stays on "Saving…" forever — there is no timeout, no watchdog and no retry. That exactly matches "it saves forever".
- The folder list is a React Query (`["note-folders"]`) with a 30s stale time, **no refetch on window focus and no realtime subscription**. A folder created in another browser/session is only picked up when that query happens to refetch — a reload of the page should pick it up, so if it still does not appear, the folder row was probably never written.
- Folder creation goes through the `create_note_folder` RPC and reports failures with a toast, but the notes tree also derives folders from `notes.folder_path`, so a half-written folder can appear and vanish.

Not verified (I could not read the database this turn — the Supabase connection returned "Forbidden"): whether the `lovable` folder row and the `lovable` note actually exist in production. That is the first thing the fix does.

The browser snapshot from your session also shows every Supabase REST call failing with `Failed to fetch` and edge functions returning 401 — i.e. the backend was unreachable at that moment. The app's job is to make that visible instead of spinning forever; today it does not.

## Step 1 — Find out what actually landed (before changing anything)

Re-establish the Supabase connection and check:

- whether a `note_folders` row with path `lovable` exists for your user, and when it was created;
- whether a note titled `lovable` exists, its `folder_path`, and its `updated_at`;
- recent Postgres/API error logs around the time of the save.

This decides whether the folder was never written (server-side failure) or written but not shown (client cache issue). Both fixes below are worth doing either way, but this tells us which one was your bug.

## Step 2 — Never spin forever on a save

In the note editor:

- Add a **save watchdog**: if a content or title write has not resolved within ~10 seconds, flip the indicator to "Couldn't save — retrying" and retry with backoff, keeping the pending text in memory (it is already held in a ref, so nothing is lost).
- Distinguish the states: `Saving…` → `Saved` → `Offline — changes kept locally` → `Save failed (reason)`. A failure shows the real message plus a "Retry now" action.
- Use the existing online/offline signal: when the browser or backend is unreachable, say so instead of showing an eternal "Saving…", and flush the queued text automatically once connectivity returns.
- Block navigation-away silently discarding: on unmount the pending payload is already flushed; add a warning toast if the flush itself fails.

## Step 3 — Make the folder tree converge

- Refetch `["note-folders"]` on window focus and on reconnect, so returning to the preview tab shows folders created elsewhere.
- Subscribe to realtime changes on `note_folders` for the signed-in user and invalidate the query on insert/update/delete, so a folder created in another browser appears without a reload.
- Surface a real error when the `create_note_folder` RPC fails, including the case where the request never completes (same watchdog treatment).
- After a successful create/rename, call `reconcile_note_folders()` so folders derived only from note paths become real rows and can no longer appear-then-vanish.

## Step 4 — Repair the current state

Once Step 1 shows what exists: if the `lovable` folder row is missing while notes point at that path, run `reconcile_note_folders()` to materialise it; if neither exists, create the folder cleanly. No note content is touched.

## Technical notes

- Files: `src/components/notes/NoteEditor.tsx` (watchdog, save-state machine, retry), `src/pages/Notes.tsx` (folder query options, realtime subscription, reconcile after mutations).
- Realtime subscription lives in a `useEffect` with `supabase.removeChannel` cleanup; requires `note_folders` in the `supabase_realtime` publication — a one-line migration if it is not already there.
- No change to note content handling, markdown conversion, or the AI processing pipeline.
