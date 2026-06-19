## Problem

Inside the Lexicon (`/lexicon/...`), most rendered links still open in a new browser tab even though we previously added click interception. The interception only runs after the browser has already seen `target="_blank"` on the anchor, and in some cases the new tab wins the race / a middle-mouse or auxclick path bypasses the handler.

Root cause: the Tiptap `Link` extension renders link marks with `target="_blank"` as a built-in default. So even links that our markdown→HTML converter outputs cleanly (e.g. `<a href="/lexicon/foo">`) are re-serialized by Tiptap with `target="_blank" rel="noopener noreferrer nofollow"` when the editor mounts. Our click handler (`handleContainerClick` in `RichTextEditor`) then has to fight that on every click — and it doesn't catch auxclick / middle-click / focused-keyboard-enter paths, so links visibly "flash open" in a new tab.

## Fix (frontend only)

Edit `src/components/RichTextEditor.tsx`:

1. Configure `LinkExt` so it never injects `target` by default. Pass `HTMLAttributes: { target: null, rel: "noopener noreferrer" }` (and keep `openOnClick: false`). That removes the Tiptap-injected `_blank` for every link the editor renders, which is what's wrapping the Lexicon body.
2. In `toEditorHtml(...)`, defensively strip `target="_blank"` from any anchor whose `href` resolves to an internal host (same origin, `INTERNAL_APP_HOSTS`, or `*.lovable.app`). This protects against historical content that has `target="_blank"` baked into the stored markdown/HTML.
3. Keep the existing `handleContainerClick` logic: for external links it still adds `target="_blank"` + safe `rel` on click. So external citations/sources continue to open in a new tab as before.
4. Also listen for `auxclick` (middle-click) on the wrapper for internal anchors and treat it like a normal same-window navigation only when the click handler already prevents default — i.e. we do *not* hijack middle-click; users can still middle-click to force a new tab. This preserves the explicit "open in new tab" escape hatch already documented in the click handler.

No changes to `WikiPage.tsx`, the markdown converter, `WikiLinkMark`, or any DB/edge code. Behavior outside the Lexicon (notes editor, etc.) uses the same `RichTextEditor`, so internal-link-in-same-window behavior becomes consistent app-wide — which matches the previously stated rule.

## Verification

- Open a Lexicon page that contains both `[[Wikilink]]` and a regular markdown `[label](/lexicon/other)` link → both navigate in the same tab.
- Cmd/Ctrl-click or middle-click on an internal Lexicon link → still opens in a new tab (escape hatch preserved).
- An external `https://example.com` link in a Lexicon page → still opens in a new tab.
