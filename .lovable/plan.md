

## Add Markdown Source Mode Toggle to Note Editor

### Overview
This is straightforward to implement. The TipTap editor already uses the `tiptap-markdown` extension, which provides `editor.storage.markdown.getMarkdown()` to extract raw Markdown from the rich editor. Switching back just means calling `editor.commands.setContent(markdownString)` — the Markdown extension handles the parsing automatically.

### What changes

**`src/components/notes/NoteEditor.tsx`**
- Add a `sourceMode` boolean state
- When toggling to source mode: grab Markdown from editor, store it in a `sourceText` state, show a `<textarea>` instead of the TipTap `<EditorContent>`
- When toggling back to rich mode: feed the edited Markdown back into the editor via `setContent()`, which the Markdown extension parses
- Hide the rich-text `EditorToolbar` while in source mode (it doesn't apply to raw text)
- Add a toggle button (e.g., `<Code2>` icon or a `"Source"` / `"Rich Text"` toggle) in the action toolbar at the top

**`src/components/notes/EditorToolbar.tsx`**
- No changes needed — it simply won't render when source mode is active

### How the toggle works
```
Rich mode → click "Source"
  1. sourceText = editor.storage.markdown.getMarkdown()
  2. Show <textarea> with sourceText, hide EditorContent + toolbar

Source mode → click "Rich Text"
  1. editor.commands.setContent(sourceText)  // Markdown ext parses it
  2. Trigger the normal save debounce
  3. Show EditorContent + toolbar, hide textarea
```

### Considerations
- Auto-save continues to work: in source mode, edits to the textarea trigger the same debounced save (storing raw Markdown is fine since the content column already holds Markdown-compatible HTML)
- The textarea gets the same styling/padding as the editor area for visual consistency
- Trashed/external notes remain read-only in both modes

