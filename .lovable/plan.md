# Fix: Freeze when opening notes from the Note Tree

## Root cause

In `src/components/notes/NoteEditor.tsx` (lines 707–734), the effect that resolves Obsidian-style attachment placeholders (`![[file.pdf]]`, `![[image.png]]`) decides whether resolution is needed using two position-sensitive regexes:

```ts
const imgNeeds    = /<img[^>]*\bsrc=""[^>]*data-attachment-name=|<img[^>]*data-attachment-name="[^"]+"(?![^>]*\bsrc=")/i.test(currentHtml);
const iframeNeeds = /<iframe[^>]*\bsrc=("|"about:blank")[^>]*data-attachment-name=|<iframe[^>]*data-attachment-name="[^"]+"(?![^>]*\bsrc="(?!about:blank")[^"]+")/i.test(currentHtml);
```

The second branch of each regex matches `data-attachment-name="…"` and then uses a **negative lookahead for `src=…` later in the same tag**. But Tiptap's `renderHTML` (in `PdfEmbed.ts` and the inline image extension) emits attributes in this order:

```
<iframe src="https://…signed-url…" frameborder="0" data-type="pdf" title="…" data-attachment-name="file.pdf"></iframe>
```

`data-attachment-name` is always the **last** attribute, so there is never a `src=` after it. The negative lookahead therefore always succeeds, even after the URL has been resolved.

Result: every `setContent(resolved)` triggers the effect again → resolves → `setContent` → … an infinite loop that pegs the main thread and freezes the UI as soon as you click a note containing a PDF or attachment-backed image.

This matches what you saw: clicking the note row, spinner appears, page never recovers.

## Fix

Replace the brittle regex-based detection with a structural check that doesn't depend on attribute order.

In `src/components/notes/NoteEditor.tsx`, inside the effect at line 707:

1. Parse `currentHtml` once with `DOMParser` into a detached document fragment.
2. Iterate over `[data-attachment-name]` elements and decide "needs resolution" only when:
   - `<img>`: missing `src` or `src=""`.
   - `<a>`: missing `href` or `href="#"` / `href=""`.
   - `<iframe>`: missing `src`, `src=""`, or `src="about:blank"`.
3. Skip the async work entirely when none match — no more setContent thrash.

Also remove the now-unused `hasImg` / `hasIframe` / `imgNeeds` / `iframeNeeds` regexes.

As a safety belt, add a `lastResolvedHtmlRef` so that if the same `currentHtml` was just resolved, the effect short-circuits even if a future bug were to mis-detect again.

## Files to change

- `src/components/notes/NoteEditor.tsx` — rewrite the detection block (≈lines 707–734).

## Out of scope

- `PdfEmbed.ts` and `upload-attachment.ts` behavior is correct and stays as-is.
- No change to navigation, NoteTree, or the LLM-config work from earlier turns.

## Verification

1. Open a note that contains an embedded PDF (`![[something.pdf]]`) from the Note Tree — should open immediately, no freeze.
2. Open a note with embedded image attachments — image still appears via signed URL.
3. Switch between two attachment-bearing notes repeatedly — no runaway CPU, no spinner stuck.
