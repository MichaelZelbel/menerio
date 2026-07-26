## What I found (verified)

- Your vault is **409 notes / ~26.7 MB of note content** (measured via SQL).
- `useNotes` (src/hooks/useNotes.ts) loads the **entire notes list including full `content`** for every note, with `refetchOnMount: "always"`.
- Every autosave (`useUpdateNote.onSuccess`) does `qc.invalidateQueries(["notes"])` **and** `broadcastInvalidation([["notes"]])`, which the cross-window listener replays with `refetchType: "all"`.

So each debounced 800 ms save currently triggers a ~27 MB list refetch in this window (whenever the list is inactive) and a full refetch in every other open window/tab. That is the lag, and it is also the lost-edit mechanism:

1. You type; the 800 ms save fires and succeeds.
2. A list refetch that started *before* the save resolves *after* it and writes the pre-edit `content` back into the cache.
3. `NoteEditor`'s sync effect sees a changed `note.content` while the editor is not focused and `pendingSaveContentRef` is already cleared → it calls `setContent()` with the **old** text.
4. The next edit (or the unmount flush) persists that old text. Your edits are gone server-side, which matches what you saw.

The regression came from layering the cross-window broadcast + `refetchOnMount: "always"` on top of a list query that carries full note bodies.

## The fix

**1. Make the notes list lightweight**
- Split the list query: `["notes", filter, userId]` selects list columns only (id, title, tags, flags, folder_path, dates, entity_type, source_*, ai_visibility) — **no `content`**, plus a short content preview column-free excerpt if the list UI needs one (it can derive from a new `substr(content,1,300)` computed select).
- Add a dedicated single-note query `["note", id]` that fetches the full row. `NoteEditor` consumes that instead of finding its note inside the big list.
- This drops per-refetch payload from ~27 MB to a few hundred KB.

**2. Stop invalidating the world on every autosave**
- In `useUpdateNote.onSuccess`, keep the local cache patch (already there), drop the blanket `invalidateQueries(["notes"])`, and broadcast/invalidate only `["note", id]` plus a coalesced list invalidation that is throttled (e.g. at most once every 5 s, or only when a list-visible field like title/tags/flags changed — not on pure `content` saves).

**3. Close the stale-overwrite race (the actual data loss)**
- Track a `lastSavedAtRef` (server `updated_at` of the newest successful save) in `NoteEditor` and **ignore any incoming `note` prop whose `updated_at` is older than that**. A late refetch can then never reset the editor to old text.
- Keep `pendingSaveContentRef` set until an incoming row actually matches the saved content, instead of clearing it on mutation success.
- Add a mutation-in-flight guard so the sync effect never calls `setContent` while a save is pending for the same note.

**4. Make saving feel instant and never silently drop**
- Serialize saves per note (single in-flight mutation + queued latest payload) so fast typing can't interleave.
- On unmount/`beforeunload`, flush pending content synchronously via the queued payload (already partly done) and surface an explicit "Save failed – retry" state rather than a silent `error` status.

## Technical notes

Files touched: `src/hooks/useNotes.ts` (query split, invalidation policy), `src/components/notes/NoteEditor.tsx` (updated_at guard, in-flight serialization, pending-ref lifecycle), `src/lib/query-sync.ts` (finer-grained keys), plus the list consumers (`NoteList.tsx`, `NoteTree.tsx`, `Notes.tsx`, sidebar/search) adjusted to the content-free list type. No database or edge-function changes required.

Verification: after the change I'll confirm (a) a single keystroke burst issues exactly one `PATCH /notes` and **no** full-list `GET`, and (b) a simulated late/stale list response no longer rewrites the editor content.
