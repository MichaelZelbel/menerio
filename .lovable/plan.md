

# Make Obsidian-style task lists with blank lines work

## Problem
When you paste this Markdown into Menerio:

```
- [x] Item A.

- [x] Item B.

- [ ] Item C.
```

…you get three separate paragraphs instead of a checklist. Obsidian and Evernote happily render it as a checklist because they tolerate blank lines between task items. Our markdown parser (and the fallback converter in `src/utils/markdown-converter.ts`) follows strict CommonMark/GFM rules and treats blank-line-separated `- [ ]` lines as independent blocks.

The TipTap editor itself is configured correctly (`TaskList` + `TaskItem.configure({ nested: true })`) and the CSS for `ul[data-type="taskList"]` already exists. The bug is purely in **how Markdown is normalized into the editor**.

## Fix

Add a small Markdown pre-processor that runs before content reaches TipTap's markdown parser. It detects sequences of task-list items separated only by blank lines and collapses the blank lines so they form a single contiguous list. After collapsing, both `tiptap-markdown` and our custom `markdownToHtml` fallback recognize it as a task list.

### What "task-list block" means here
A run of two or more consecutive non-blank lines that each look like `- [ ] ...` or `- [x] ...` (with optional indentation), separated only by blank lines. We collapse the blank separators inside the run; we do not touch surrounding paragraphs.

### Where the fix lives

1. **`src/lib/note-content.ts`** — add `coalesceTaskList(md: string): string` and call it from `normalizeNoteContent` before returning. This is the single funnel both initial load and `setContent` go through, so it covers:
   - Loading a note from the DB
   - External/synced notes
   - Markdown that arrives via paste (we also wire it into the paste handler — see step 2)

2. **`src/components/notes/NoteEditor.tsx`** — add a `transformPasted`/paste handler so that pasting Obsidian-style Markdown directly into the editor also gets normalized. The simplest path is a TipTap `editorProps.handlePaste` that runs the same `coalesceTaskList` on `text/plain` clipboard data before letting `tiptap-markdown`'s `transformPastedText` pick it up.

3. **`src/utils/markdown-converter.ts`** — apply `coalesceTaskList` at the top of `markdownToHtml` so the legacy converter (used in some import paths) also benefits. This keeps the two render paths consistent.

### Algorithm sketch

```text
TASK_LINE = /^(\s*)- \[[ xX]\]\s+/

split markdown into lines
walk lines, marking task-line indices
for each maximal run of task-line indices separated only by blank lines:
    drop the blank lines between them
re-join
```

Idempotent: running it twice on already-tight task lists is a no-op.

## What this does NOT change
- No new dependencies.
- TipTap extension list, schema, and CSS stay as-is.
- HTML → Markdown (export) path is unchanged — it already emits tight task lists.
- Non-task lists (regular `- bullet` items separated by blank lines) are untouched.

## Test additions (`src/utils/__tests__/markdown-converter.test.ts`)
- Blank-line-separated `- [ ]` items become a single `<ul data-type="taskList">` with all items.
- Mixed checked/unchecked states are preserved (`data-checked="true"`/`"false"`).
- Tight task list (no blank lines) still renders correctly (idempotency).
- A regular `- A\n\n- B` bullet list is **not** merged into one list (only task syntax triggers coalescing).

## Files touched

| File | Action |
|------|--------|
| `src/lib/note-content.ts` | Add `coalesceTaskList`; call it inside `normalizeNoteContent` |
| `src/components/notes/NoteEditor.tsx` | Add `editorProps.handlePaste` to coalesce pasted Markdown |
| `src/utils/markdown-converter.ts` | Run `coalesceTaskList` at top of `markdownToHtml` |
| `src/utils/__tests__/markdown-converter.test.ts` | Add 4 test cases described above |

## Note on the reported build errors
The TypeScript errors about `@tiptap/core`, `@tiptap/extension-underline`, and `@tiptap/pm/state` not being found are not new — these packages are used throughout the working editor and are in `package.json`. They look like a stale dependency-install / TS-server state and should clear automatically on the next install + typecheck cycle. No code change is required for them; if they persist after this fix is implemented, a clean `bun install` will resolve them.

