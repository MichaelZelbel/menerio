# Plan: Stop the app-wide freeze

## What is actually happening

Two symptoms, one root cause:

1. **Clicking "Notes" in the sidebar feels stuck.** The router URL is `/dashboard/notes/:noteId` (deep-linked from the last opened note), so the sidebar click re-mounts `NoteEditor` for that note. The freeze starts there, not in the sidebar code.
2. **Clicking any specific note freezes completely.** Same `NoteEditor` mounts again for the new note, same effect runs, same lockup.

The browser tells the story:
- DOMContentLoaded on `/dashboard/notes` is **11.6 s** and cumulative task time is **2.4 s** on a page that should be near-instant.
- A Vite dep chunk returns **502** mid-load (`chunk-Y2G7AXWB.js`), consistent with the dev server being repeatedly hit while the main thread is busy.
- No runtime exception is thrown — the tab is alive but unresponsive, which is the signature of a tight render/effect loop, not a crash.

## Which previous change caused it

The freeze was introduced in **my last fix to `src/components/notes/NoteEditor.tsx`** — the one in `.lovable/plan.md` that replaced the regex-based attachment detection with a `DOMParser` + `lastResolvedHtmlRef` guard inside the effect at lines 708–763.

Why that fix is wrong:

- The effect's deps are `[editor, note.id, note.content, user?.id]`.
- Inside the effect we read `editor.getHTML()` and compare against `lastResolvedHtmlRef.current`. After we call `editor.commands.setContent(resolved, { emitUpdate: false })`, **Tiptap re-parses and re-serializes**, so the next `editor.getHTML()` is not byte-equal to `resolved` (attribute order, whitespace, the `<div class="embed-pdf-wrapper">` wrapper around `<iframe data-type="pdf">`, the wikilink-span rewrites in `resolveWikilinks`). The cache key we stored therefore never matches the value we read next time.
- The structural "needs resolution" check walks `[data-attachment-name]` elements. For PDFs, Tiptap's `PdfEmbed.renderHTML` always emits the iframe wrapped in a div, so a re-parse can re-introduce the wrapper and momentarily reset `src` to `"about:blank"` for one tick (the default in `renderHTML` when the attr round-trips through `mergeAttributes`). The check then says "needs = true" again.
- `note.content` is in the deps. Every save (`updateNote.mutate` from `onUpdate`) invalidates the `notes` query, the parent re-renders with a new `note` object, `note.content` changes by reference, and the effect runs again — re-resolving, re-`setContent`-ing, scheduling another invalidation cascade through the autosave timer. On notes that contain `![[file.pdf]]` or `![[image.png]]`, this becomes a hot loop that monopolises the main thread. That is what looks like "the app froze".

The earlier symptom (the regex always reporting "needs resolution") was real, but the fix I shipped still has the same shape — an effect that writes to the editor it observes — and now it triggers on every save, not just initial mount.

The edge-function / LLM-config work from the earlier turns did not touch any frontend rendering path and is not implicated.

## Clean fix

Stop treating attachment resolution as a reactive effect. Do it **once per note open**, before the editor ever sees the unresolved HTML, and never again from inside an effect that depends on editor content.

Concretely, in `src/components/notes/NoteEditor.tsx`:

1. **Delete the effect at lines 708–763** entirely. Also delete `lastResolvedHtmlRef` (line 389) — it only existed to paper over the loop.
2. **Resolve at the source.** Wrap every `setContent(editorContent, …)` call that can introduce `data-attachment-name` placeholders with a small helper:
   ```ts
   const setEditorContentWithAttachments = (html: string) => {
     if (!editor) return;
     editor.commands.setContent(html, { emitUpdate: false });
     if (!user?.id || !html.includes("data-attachment-name=")) return;
     // Fire-and-forget; never re-enters because we don't observe getHTML().
     resolveAttachmentImagesInHtml(html, user.id).then((resolved) => {
       if (!editor || editor.isDestroyed || editor.isFocused) return;
       if (resolved === html) return;
       editor.commands.setContent(resolved, { emitUpdate: false });
     }).catch(() => {/* ignore */});
   };
   ```
   Use it at:
   - the note-switch effect (lines 661 and 666),
   - the `menerio:note-updated` handler (line 690),
   - the source-mode round-trip (line 967).
3. **Initial mount.** `useEditor`'s `content` is computed synchronously from `note.content`. Add a tiny `useEffect(() => { …same helper, but read note.content once… }, [editor])` that runs only when the editor instance is created — not when `note.content` changes. Subsequent prop changes are already covered by the note-switch effect above.
4. **Save-driven re-renders are now safe.** Because no effect reads `editor.getHTML()` and writes back to it, the autosave → query-invalidate → prop-change cycle can no longer feed itself.

## Files to change

- `src/components/notes/NoteEditor.tsx` — remove the resolver effect (708–763) and the `lastResolvedHtmlRef`; add `setEditorContentWithAttachments`; route the four `setContent` call sites through it; add a one-shot `useEffect([editor])` for initial resolution.
- `.lovable/plan.md` — replace the old plan describing the failed fix with this one.

No changes to `resolveAttachmentImagesInHtml`, `PdfEmbed`, `FileUploadHandler`, or any edge function.

## Verification

1. `/dashboard/notes` opens immediately; main thread idle within ~200 ms.
2. Click any note in the tree, including notes with embedded PDFs and images — opens immediately, no spinner stuck.
3. Type in a note with `![[image.png]]` — saves complete, no runaway CPU, signed URL still resolves once and the image stays visible.
4. Switch between two attachment-bearing notes 5× in a row — flat CPU, no growing memory.
5. `chunk-Y2G7AXWB.js` 502s stop reappearing once the main thread is no longer saturated.

## Out of scope

- The Vite 502 itself (dev-server artifact, will clear once the loop is gone).
- The earlier LLM-config refactor across edge functions — unrelated to this freeze; leave as-is.
