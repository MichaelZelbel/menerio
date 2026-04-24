I found two likely root causes in the editor:

1. The editor saves Markdown after each local update, then React Query invalidates and feeds the saved note back into the editor. The current guard compares raw Markdown to incoming note content, but the editor/serializer changes Markdown syntax during typing, especially for headings, hard breaks, bullets, and escaped `#`. That lets a delayed save overwrite the live ProseMirror state and produces the “formats correctly for a moment, then reverts with backslashes” behavior.
2. The console shows TipTap duplicate extension warnings for `link` and `underline`. In TipTap v3, `StarterKit` already includes these, but the editor also registers them separately. This can make markdown shortcuts and input rules unstable.

Plan:

1. Stabilize the TipTap extension setup
   - Configure `StarterKit` to disable its built-in `link` and `underline` extensions.
   - Keep the explicit `LinkExt.configure({ openOnClick: false })` and `UnderlineExt` instances so toolbar behavior remains the same.
   - This should remove the duplicate extension warning.

2. Stop server echo updates from resetting active typing
   - Replace the raw `lastLocalContentRef` equality check with a normalized “last saved / last local” content comparison.
   - Compare canonical editor HTML or canonical Markdown rather than raw strings, so `# headline`, escaped `\#`, hard breaks, and list serialization differences do not look like external changes.
   - Do not call `editor.commands.setContent(...)` for the same note while the editor is focused and the incoming content is just the result of the user’s own autosave.

3. Fix autosave race conditions
   - Track pending autosave content per note id.
   - When the mutation returns and React Query invalidates notes, mark the returned content as acknowledged instead of re-importing it into TipTap.
   - Clear timers and refs correctly when switching notes.

4. Make source-mode conversion consistent
   - When leaving Markdown source mode, convert Markdown to TipTap HTML the same way initial note load does.
   - Avoid passing raw Markdown into `setContent` in one place and converted HTML in another.

5. Add regression coverage
   - Add/extend tests around Markdown conversion for:
     - headings (`# Title`) not becoming escaped regular text,
     - bullets not gaining extra blank/hard-break lines,
     - hard-break backslashes not multiplying over repeated round-trips.
   - Run the existing test suite and TypeScript check.

Expected result:
- Typing `# Heading` / `## Heading` should remain a heading after autosave.
- Bullets should keep the cursor inside the list item, not one line below it.
- Backslashes should no longer appear or multiply after typing/pasting and autosave.
- TipTap duplicate extension warnings should disappear.