# Fix: folder rename and folder/note creation in the notes tree

## What I found

Checked the live database and the network snapshot from your attempt at 20:04–20:05 UTC.

- The folder table still has **`Projects/Ownward`** — no folder row was written or renamed today at all.
- Meanwhile **3 empty notes created at 20:01, 20:03 and 20:04 sit in `Projects/OwnWards`**, a path that has no folder row. That is the "duplicate folder that then vanished": the tree also derives folders from note paths, so the new name appeared as a ghost folder and disappeared again on the next refresh.
- At exactly 20:04:55 a burst of requests to the backend failed outright (`Failed to fetch` on the folder lookup, the notes query, the wiki query; a `546 WORKER_RESOURCE_LIMIT` on a background function; then `401 Unauthorized` on edge functions). The backend was briefly unreachable/overloaded — my own database queries were timing out a few minutes ago too, and now succeed.

So there were two problems stacked on each other: a transient backend outage, and folder code that turns a transient failure into permanent, half-applied mess with no clear error.

Why the code makes it worse:

- Rename is a **client-side loop of many separate requests** (fetch folder rows, update each one, fetch notes, update each note). There is no transaction — if any request fails midway, part of the rename is applied and part is not, and the tree is left inconsistent.
- The conflict pre-check treats a failed request the same as "no conflict" and proceeds.
- Folder create uses an upsert that never sends `user_id` and reports only a generic "Failed to create folder".
- Note creation from the tree (`handleCreate`, `handleCreateInFolder`) calls the mutation with **no error handling at all** — a failure is completely silent, which is exactly the "I created a note and nothing happened".
- Rename and new-folder use `window.prompt`. Browsers suppress prompts in embedded/preview contexts; when suppressed it returns null and the action silently does nothing.

## The fix

1. **Make folder operations atomic on the server.** Add three security-definer database functions, each scoped to the signed-in user and each running in a single transaction:
   - `rename_note_folder(old_path, new_path)` — rewrites the folder row, all descendant folder rows and all affected `notes.folder_path` values at once, rejecting a rename onto an existing path.
   - `move_note_folder(source_path, target_parent_path)` — same rewrite, with the cycle check ("can't move a folder into itself") enforced in SQL.
   - `create_note_folder(path)` — inserts folder plus any missing ancestor rows, idempotent.
   The client calls one RPC instead of N requests. Either the whole rename happens or nothing does.

2. **Eliminate ghost folders.** Add `reconcile_note_folders()`, which creates folder rows for every distinct `notes.folder_path` that lacks one. Run it once as data repair (this restores `Projects/OwnWards` as a real folder) and call it after folder operations so the tree can never show a folder that cannot be renamed.

3. **Never fail silently.** Wrap every folder and note-create action in try/catch with a toast that includes the actual error message, and treat a failed conflict pre-check as a failure rather than as "go ahead".

4. **Replace `window.prompt` with a real dialog** for rename and new folder, so the action works in the preview iframe and shows validation inline.

5. **Move folders into React Query** (`["note-folders"]`) instead of manual `useState` + `refreshFolders`, so folders and notes invalidate together and the tree can't display stale paths after an operation.

6. **Offline/unavailable guard.** If an RPC fails because the backend is unreachable, leave the tree untouched and show a "Couldn't reach the server — try again" toast with the operation name, instead of applying a partial change.

## Data repair included

- Reconcile `Projects/OwnWards` into a real folder row (with the 3 notes already in it), and leave `Projects/Ownward` and its 1 note alone unless you want them merged — say the word and I'll fold the old folder into the new name in the same pass.

## Technical notes

- New migration: three RPCs plus `reconcile_note_folders()`, all `SECURITY DEFINER`, `SET search_path = public`, filtering on `auth.uid()`, with `GRANT EXECUTE ... TO authenticated`.
- Path rewriting uses a single `UPDATE ... WHERE path = old OR path LIKE old || '/%'` with `new_path || substring(path from length(old)+1)`, with `LIKE` metacharacters escaped.
- Files touched: `supabase/migrations/<new>.sql`, `src/pages/Notes.tsx` (folder handlers → RPC calls, React Query, error handling), `src/components/notes/NoteTree.tsx` (dialog-based rename/new-folder prompts).
- No change to note content, editor, or sync behaviour.
