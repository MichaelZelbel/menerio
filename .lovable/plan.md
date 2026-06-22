## Problem

In the note editor, the Undo button never lights up. The toolbar calls `editor.can().undo()` directly during render (`src/components/notes/EditorToolbar.tsx`), but the toolbar component does not subscribe to TipTap's transaction stream. On first render — right after a note loads — history is empty, so the button mounts disabled and stays disabled even as the user types and builds up history. Same staleness affects every other reactive button (bold/italic active states, list active, redo, etc.), they just happen to be less obvious.

The user's note content is fine — undo is purely a UI wiring bug.

## Fix

Make `EditorToolbar` re-render on every TipTap transaction so `editor.can().undo()`, `editor.can().redo()`, and every `editor.isActive(...)` call reflect the live editor state.

Two small, low-risk options (I'd go with option A):

**A. Subscribe via `useEffect` + `forceUpdate` in `EditorToolbar`** (works with current `@tiptap/react` version, no API risk)
- In `EditorToolbar`, add a `useState` counter and a `useEffect` that registers `editor.on('transaction', tick); editor.on('selectionUpdate', tick); editor.on('update', tick)` and cleans up on unmount. That forces the toolbar to re-render on every editor change.

**B. Use `useEditorState` from `@tiptap/react`** (cleaner, but only if the installed version exposes it)
- Replace the direct `editor.can()/isActive()` reads with a `useEditorState({ editor, selector })` so only the derived booleans drive re-render.

I'll verify which is available and pick A as the safe default; behavior is identical to the user.

## Scope

- Edit only `src/components/notes/EditorToolbar.tsx`.
- Do not change `NoteEditor.tsx`, the StarterKit config, autosave, or the `setContent` paths — those are working correctly and history is preserved between autosaves (autosave skips `setContent` while the editor is focused / while a pending save matches).
- Do not touch `RichTextEditor.tsx` (used by other surfaces, e.g. shared notes). Its toolbar has the same latent issue but the user reported the bug in the note editor; I'll keep this change minimal and we can mirror it later if you want.

## Verification

1. Open the affected note (`/dashboard/notes/88b295be-…`), type a few characters, watch the Undo button enable.
2. Click Undo → last keystroke reverts. Click Redo → it reapplies.
3. Use Cmd/Ctrl+Z as well to confirm keyboard undo (which already worked through ProseMirror) still works.
4. Confirm autosave still fires (status indicator) and no extra re-renders cause lag while typing in a long note.

No backend, no migrations, no edge function changes.
