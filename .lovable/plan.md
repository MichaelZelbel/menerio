# The AI edit worked, but the app still cried "not saved"

## What is actually happening

The write and the display were both fine. The false alarm comes from how the
editor *proves* to the chat that the edit landed.

After an AI edit, `NoteEditor.tsx` renders the new Markdown into HTML and then
verifies convergence with a raw string comparison:

```text
normalizeEditorHtml(renderedHtml) === normalizeEditorHtml(editor.getHTML())
```

That is the wrong comparison. `editor.getHTML()` is Tiptap's *re-serialization*
of the parsed document, so it legitimately differs from the input string even
when the document is exactly right: autolinked URLs gain marks and attributes,
attribute order and quoting change, empty paragraphs are added or dropped, and
`data-attachment-*` images get rewritten by the async attachment resolver that
runs a tick after `setContent`.

The note in the screenshot is exactly that case: two bare URLs plus a
paragraph. The document was applied correctly, the string still didn't match,
so the editor acked `applied: false` with "editor content did not converge",
`applyNoteEditVerified` retried with `force`, the forced pass compared the same
two strings and failed again, and both chat surfaces reported failure — the FAB
as a red toast, the side panel as a red error line.

So: a comparison that can never be reliably true is being used as a hard
failure signal.

## The fix

### 1. Compare documents, not HTML strings

Verify convergence on the canonical Markdown representation, which is what the
app actually stores and what the round-trip is defined against:

```text
normalizeSavedMarkdown(editorToMarkdown(editor)) === normalizeSavedMarkdown(content)
```

Both helpers already exist in `NoteEditor.tsx`. This is immune to Tiptap's HTML
re-serialization, attribute ordering, and autolink decoration.

Add a tolerant second chance before declaring failure: compare plain text
(`editor.getText()` against the Markdown stripped of syntax, whitespace
collapsed). If the visible text matches, the edit is on screen — that is what
the user cares about — so ack success.

### 2. Give the async resolver a beat

`setEditorContentWithAttachments` finishes the attachment pass asynchronously.
Re-check convergence on the next animation frame / short microtask delay before
concluding it failed, so notes with images stop producing spurious mismatches.

### 3. Make the failure message match reality

Only a genuine divergence should surface. When it does, the wording should stop
implying data loss — the row *is* saved. Both surfaces get the same text:
"Saved. The editor view may be out of date." with the existing "Reload note"
action, rendered as a warning rather than an error.

### 4. Keep the real protection

Nothing about the safety mechanism goes away: the stale-autosave drop, the
`updated_at` watermark and the forced refetch on real mismatch all stay. Only
the *proof* changes from a brittle string identity to a document-level check.

### 5. Tests

Extend `src/lib/__tests__/note-ai-edit.test.ts` and add editor-level cases
covering: autolinked URL content (previously false-failed) acks applied;
content with an attachment image acks applied after the resolver settles;
genuinely different content still acks failed and triggers the forced retry.

## Technical notes

- Files: `src/components/notes/NoteEditor.tsx` (convergence check in the
  `NOTE_UPDATED_EVENT` handler), `src/components/chat/GlobalAIChatFAB.tsx` and
  `src/components/notes/NoteChatPanel.tsx` (message wording/severity only).
- No edge function, database, or note-writing changes.
