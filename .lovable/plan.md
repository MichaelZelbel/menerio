## Investigation findings

The current freeze is not the same attachment loop I previously fixed.

I checked the reported note in the database:

- Note: `Streaming Server VPS`
- Size: ~5.4k characters, ~153 lines
- Attachments: 0 `data-attachment-name` placeholders, 0 images, 0 PDF iframes
- Links: 23 URLs, 12 markdown links

So this specific freeze is not caused by PDF/image signed-URL attachment resolution.

The new culprit is the Obsidian-style Notes folder/node tree that was added earlier to improve Notes navigation.

## What introduced this behavior

The freezing path was introduced by the previous Obsidian-like navigation change that created `src/components/notes/NoteTree.tsx` and wired it into `src/pages/Notes.tsx`.

The problematic choices in that change are:

1. `FolderRow` and `NoteRow` are defined inside the `NoteTree` render function.
   - Every `NoteTree` render creates new component types.
   - React cannot preserve the row tree; it effectively remounts the visible folder/note tree repeatedly.

2. Folder flattening is done inside every row render.
   - `NoteRow` recomputes `tree.children.flatMap(flattenFolders)` for every visible note.
   - `FolderRow` recomputes move targets for every folder.
   - This turns one tree render into repeated full-tree traversals.

3. Folder note counts are computed recursively during render.
   - `countNestedNotes(node)` runs for every folder row.
   - This repeats work that can be computed once when the tree is built.

4. The auto-expand effect always creates a new `Set`.
   - The effect depends on the full `notes` array and `selectedId`.
   - When a note is clicked, query/cache updates or route changes cause the effect to run.
   - It returns a new `Set` even when nothing actually changed, forcing another full tree render.

5. Selecting a note also mounts `NoteEditor`, which currently does synchronous markdown → HTML → wikilink resolution → TipTap parsing on the same click.
   - That editor work is not the root cause for `Streaming Server VPS`, but it amplifies the perceived freeze after the tree has already blocked the main thread.

## Why clicking `Streaming Server VPS` freezes

Clicking the note triggers this chain:

```text
click note row
→ set active folder
→ set selected note
→ route changes to /dashboard/notes/:id
→ NoteTree rerenders/remounts rows
→ NoteTree auto-expand effect forces another render
→ NoteEditor mounts and synchronously converts/parses note content
```

On the main user account, the Notes page has roughly:

- 202 active notes
- 31 saved/distinct folders
- ~1MB total note content
- one very large note around 447k characters

That data size makes the current tree/render pattern fragile. The selected note itself does not need to be large for the click to freeze, because the expensive work happens around the whole tree and editor selection pipeline.

## Clean fix plan

### 1. Refactor `NoteTree` so row rendering is stable

In `src/components/notes/NoteTree.tsx`:

- Move `FolderRow` and `NoteRow` out of the `NoteTree` component body.
- Wrap rows with `React.memo` where appropriate.
- Pass only stable props into rows.
- Use `useCallback` for folder toggle, note click, move, and drag handlers where it prevents unnecessary row updates.

Expected result: selecting a note no longer remounts the entire visible tree.

### 2. Precompute folder metadata once per tree change

In `NoteTree.tsx`:

- Add nested note count directly to each `FolderNode` while building/sorting the tree, or build a `Map<folderPath, count>` in one `useMemo`.
- Build `flatFolders` once in a `useMemo`.
- Build move-target lists from that cached flat folder list instead of recomputing `flattenFolders` in every row.

Expected result: render cost becomes closer to linear in visible rows instead of repeated full-tree traversal per row.

### 3. Fix the auto-expand effect so it does not force redundant renders

In `NoteTree.tsx`:

- Compute `selectedFolderPath` once from `selectedId` and `notes`.
- Make the expand effect depend on `activeFolderPath` and `selectedFolderPath`, not the entire `notes` array.
- Inside `setExpanded`, return the current `Set` when no new folder key was added.

Expected result: selecting a note does not cause a second full render unless the selected folder genuinely needs to be opened.

### 4. Reduce synchronous editor work during note selection

In `src/components/notes/NoteEditor.tsx`:

- Short-circuit the note-sync effect before running markdown/HTML/wikilink conversion when the incoming `note.content` already matches the local editor state or a pending save.
- Only run `contentToEditorHtml`, `resolveWikilinks`, `editor.getHTML`, and `normalizeEditorHtml` when:
  - the selected note id actually changed, or
  - a true remote content update arrives while the editor is not focused.
- Keep the attachment resolver non-reactive, but add a stale-note guard/version guard so async attachment resolution cannot write into the wrong note after fast navigation.

Expected result: note selection remains responsive, and query/cache refreshes do not repeatedly reprocess the same note content.

### 5. Fix stale graph/connection navigation route

There is still one legacy navigation path:

- `src/components/notes/ConnectionsPanel.tsx` navigates to `/dashboard/notes?selected=<id>`.
- The current Notes page uses `/dashboard/notes/:noteId` and does not read `?selected=`.

Update this to `/dashboard/notes/:id` so all note navigation uses one route model.

Expected result: graph/connection navigation cannot enter a partially synced selection state.

## Verification plan

After implementation, I will verify with browser profiling, not just code inspection:

1. Open `/dashboard/notes`.
2. Expand the Notes tree / Vault root.
3. Click `Streaming Server VPS` or the closest available matching note in the authenticated preview context.
4. Capture a CPU profile around the click.
5. Confirm:
   - no long main-thread lock after node click,
   - no repeated `NoteTree` remount/render cascade,
   - no attachment resolver loop,
   - route updates to `/dashboard/notes/:id`,
   - editor appears and remains interactive.
6. Re-run with repeated note switching to ensure the freeze does not come back after cache/query updates.

## Files to change

- `src/components/notes/NoteTree.tsx`
- `src/components/notes/NoteEditor.tsx`
- `src/components/notes/ConnectionsPanel.tsx`
- `.lovable/plan.md` only if we want the internal plan document to reflect the corrected root cause

## What I will not do

- No database migration.
- No changes to stored note content.
- No rollback of the entire Notes tree feature.
- No changes to attachment storage or Supabase Edge Functions for this specific freeze.