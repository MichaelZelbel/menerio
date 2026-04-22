
# Make Obsidian/Evernote task syntax render as real checklists in Menerio

## Revised diagnosis
The earlier blank-line theory is not the core issue.

What the app is missing is this behavior:
- When a user types or pastes Markdown task syntax like `- [ ]` / `- [x]`
- the editor should convert that syntax into actual TipTap `taskList` / `taskItem` nodes
- so the UI shows clickable checkboxes and checked items get struck through

Right now:
- the checklist UI/CSS already exists
- the toolbar can already create task lists manually
- but raw Markdown task syntax is not being promoted reliably into real task nodes
- and the current paste workaround is brittle
- plus the current branch has genuine CI/build issues from missing explicit Tiptap packages

## UX target
After this change, the experience should be:

1. Paste Obsidian/Evernote checklist Markdown into a note
   - it immediately renders as a real checklist with boxes
   - checked items appear checked and struck through

2. Type checklist Markdown manually in the rich editor
   - entering `- [ ] ` or `- [x] ` should turn the current line into a checklist item
   - subsequent Enter presses should continue the checklist naturally

3. Toggle a checkbox
   - the visual state updates immediately
   - saving still stores Obsidian-compatible Markdown in the DB

4. Switch to Source Mode
   - the same content appears as Markdown (`- [ ]`, `- [x]`)
   - switching back to rich mode restores real checkboxes

## Implementation plan

### 1) Fix the broken Tiptap dependency setup first
The current “module not found” errors are real and need to be fixed before anything else.

Update dependencies so the code matches the imports already used:
- add explicit `@tiptap/core`
- add explicit `@tiptap/pm`
- add explicit `@tiptap/extension-underline`

Then refresh the lockfile(s) so CI sees the same dependency graph locally and on GitHub.

### 2) Stop relying on raw Markdown auto-detection for checklist rendering
The editor currently feeds Markdown directly into `setContent()` and assumes the Markdown extension will always turn task syntax into proper task nodes. That is the weak point.

Instead:
- if note content is Markdown, convert it through `markdownToHtml(normalizeNoteContent(...))` before passing it into the editor
- keep legacy HTML notes as HTML
- keep saving back to Markdown using the existing serializer (`storage.markdown.getMarkdown()`)

This keeps DB storage Markdown-native while making rendering deterministic.

### 3) Replace the synthetic paste event workaround with direct task-list insertion
The current paste fix re-dispatches a synthetic `ClipboardEvent`, which is fragile.

Replace it with a direct flow in `NoteEditor`:
- read `text/plain` from the clipboard
- detect task-list Markdown
- normalize it with `coalesceTaskList`
- convert it with `markdownToHtml`
- insert that rendered content directly at the current selection

For non-task pastes, fall back to the normal editor pipeline.

This makes pasted checklists reliable regardless of how `tiptap-markdown` handles pasted text internally.

### 4) Add a real Markdown shortcut for manual typing
To match Obsidian/Evernote expectations, typing the syntax should also work, not only pasting.

Add a small editor extension or input rule that watches the current line for:
- `- [ ] `
- `- [x] `

When the pattern is completed, convert that line into a `taskItem` with the correct checked state.

This is the missing UX behavior the user is describing.

### 5) Preserve existing checkbox behavior after conversion
Once the content is a real TipTap task list:
- clicking a checkbox should toggle `checked`
- checked items should remain visually struck through
- saving should serialize back to Markdown with `- [x]` / `- [ ]`

No separate checklist storage model should be introduced.

### 6) Clean up the TypeScript issues uncovered by CI
Alongside the checklist fix, resolve the current compile errors:

- `insertWikilink` typing:
  - once `@tiptap/core` is installed, the module augmentation should resolve
  - if not, tighten the command typing or add a local typed wrapper so call sites compile cleanly

- `FileUploadHandler` unknown-to-File errors:
  - explicitly narrow dropped/pasted files to `File[]`
  - avoid relying on inference from ProseMirror event types

This keeps the feature branch buildable again.

## Files to update

| File | Change |
|---|---|
| `package.json` | Add missing Tiptap dependencies |
| `bun.lock` / `package-lock.json` | Refresh lockfile(s) for CI consistency |
| `src/components/notes/NoteEditor.tsx` | Use deterministic Markdown→HTML hydration, replace paste handler, wire typing shortcut |
| `src/components/notes/extensions/FileUploadHandler.ts` | Tighten file typing |
| `src/components/notes/extensions/WikilinkExtension.ts` | Verify/fix command typing if needed after dependency fix |
| `src/lib/note-content.ts` | Keep normalization utility; retain coalescing as a helper, not the main fix |
| `src/utils/markdown-converter.ts` | Continue using task-list HTML conversion as the canonical render bridge |
| `src/utils/__tests__/markdown-converter.test.ts` | Keep/update checklist conversion tests |
| `src/components/notes/...` | Add a small markdown-task shortcut extension if implemented as a separate file |

## Verification checklist
After implementation, verify all of these:

1. Paste the user’s sample Markdown into a note
   - real checkboxes appear
   - checked items are checked and struck through

2. Type a new item manually with `- [ ] `
   - it becomes a checklist item without using the toolbar

3. Toggle a checkbox
   - save
   - reload the note
   - state remains correct

4. Switch to Source Mode and back
   - Markdown stays Obsidian-compatible
   - rich mode still shows checkboxes

5. Run CI/build checks
   - no missing Tiptap module errors
   - no `insertWikilink` typing errors
   - no `unknown`→`File` errors

## Key technical constraint
The fix should preserve the project rule:
- notes remain stored as Markdown in the database
- the change only improves how Markdown task syntax is interpreted and rendered inside the TipTap editor
