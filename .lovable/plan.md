## Goal

Make web-clipped notes visually recognizable: show a hero image at the top, plus a way to view the full captured page exactly as it looked, while keeping all text searchable.

## Why the current note looks empty

The SingleFile capture function only extracts the page's plain text and stores the original HTML as an attachment. It never pulls out an image, and the snapshot HTML is only a downloadable file — never rendered. So the note for `menerio.com` shows "Source + text", no visuals.

Three changes fix this.

---

## 1. Extract a hero image during capture

In `supabase/functions/singlefile-capture/index.ts`, after parsing the HTML, look for a representative image in this priority order:

1. `<meta property="og:image">`
2. `<meta name="twitter:image">`
3. `<link rel="image_src">`
4. The first reasonably-sized `<img>` in `<body>` (skip tiny icons/tracking pixels — width/height ≥ 200, or unknown but not in `<header>`/nav).

SingleFile inlines images as `data:image/...;base64,...` URIs, so in most cases the bytes are already inside the uploaded HTML — no extra network fetch needed.

For each candidate:

- If it's a `data:` URI → decode the base64 directly.
- If it's an `http(s)` URL → fetch it server-side (with a 5 s timeout, 5 MB cap, and content-type allow-list of `image/jpeg|png|webp|gif`). Skip on failure.

Save the image to the `note-attachments` bucket as `<slug>-hero.<ext>`, register it in `note_attachments` (source `singlefile`), and embed it at the very top of the Markdown body using the existing Obsidian-style wikilink syntax:

```md
![[menerio-com-hero.jpg]]

**Source:** [menerio.com](https://menerio.com)

> Meta description here…
```

This reuses the existing `resolveAttachmentImagesInHtml` pipeline in `src/lib/upload-attachment.ts`, so the image renders inline in the editor with no other UI changes.

## 2. Render the saved snapshot as a visual preview

Add a "Page snapshot" panel to the note view that loads the saved HTML attachment in a sandboxed `<iframe>`, giving an exact visual of the clipped page (since SingleFile already inlined CSS + images).

- Create `src/components/notes/WebClipPreview.tsx`.
- Render only when `note.metadata.web_clip?.snapshot_storage_path` is set.
- Fetch a signed URL for the snapshot (7-day TTL, matching other attachments).
- Embed inside `<iframe sandbox="allow-same-origin" referrerpolicy="no-referrer" loading="lazy">` — no `allow-scripts`, so any scripts inside the snapshot can't run. Tracking pixels in the captured HTML are blocked by `referrerpolicy`.
- Collapsible, default open at ~500 px height with an "Open full snapshot" link to the signed URL in a new tab.

Wire it into `src/components/notes/NoteEditor.tsx` (or wherever the existing source-badge for `source_app === 'singlefile'` lives — check both `NoteEditor.tsx` and any sidebar panel before placing it).

## 3. Keep text searchable (no change needed, but verify)

The existing `htmlToPlainText` extraction (capped at 50 k chars) and the fire-and-forget `process-note` call already cover full-text + semantic search. We'll re-confirm both still run after the new hero-image step inserts a new attachment.

---

## Technical details

**New helper in `singlefile-capture/index.ts`**

```ts
async function extractHeroImage(html: string): Promise<{ bytes: Uint8Array; mime: string; ext: string } | null>
```

- Regex-scan `<meta>`, `<link>`, then first `<img src="...">`.
- Resolve `data:` URIs locally; fetch `http(s)` with `AbortSignal.timeout(5000)` and `Content-Length` ≤ 5 MB.
- Return `null` on any failure; capture must still succeed without a hero image.

**Storage layout (unchanged buckets)**

- `note-attachments/<userId>/<uuid>.html` — full snapshot (existing)
- `note-attachments/<userId>/<uuid>.<ext>` — new hero image, registered in `note_attachments` with a readable filename like `hero-menerio-com.jpg`

**Metadata addition** on the note:

```json
"web_clip": {
  ...,
  "hero_image_attachment": "hero-menerio-com.jpg",
  "hero_image_storage_path": "<userId>/<uuid>.jpg"
}
```

**WebClipPreview component sketch**

```tsx
<div className="rounded-lg border bg-muted/20">
  <button onClick={() => setOpen(!open)} className="...">
    Page snapshot {open ? <ChevronUp/> : <ChevronDown/>}
  </button>
  {open && signedUrl && (
    <iframe
      src={signedUrl}
      sandbox="allow-same-origin"
      referrerPolicy="no-referrer"
      loading="lazy"
      className="w-full h-[500px] rounded-b-lg bg-white"
    />
  )}
</div>
```

**Backfill (optional)**: Existing web clips won't have hero images. Add a one-shot script later if the user wants to backfill — out of scope for this change unless requested.

**Tests**: Extend `supabase/functions/singlefile-capture/` Deno tests (or add one) with two cases: HTML with `og:image` data URI → hero saved; HTML with no images → note still created, no hero.

## Out of scope

- Server-side screenshots via headless Chromium (heavy infra, not needed since SingleFile already captures a faithful HTML snapshot we can re-render).
- Inlining all images from the page into the Markdown body (would balloon notes; the iframe preview covers this).
