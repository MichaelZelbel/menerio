## Two real bugs found

I checked your Grammarly clip in the database. Two things are broken:

### Bug 1 — `metadata.web_clip` is wiped out after AI processing

The capture function correctly stores `metadata.web_clip = { snapshot_storage_path, hero_image_attachment, hostname, … }` on the note. But the background `process-note` edge function then **replaces** the entire `metadata` field with the AI-extracted topics/summary/people (`supabase/functions/process-note/index.ts` line 904 — `update({ embedding, metadata })`). So:

- `metadata.web_clip` → `null` (you can verify in the DB: the Grammarly note has no `web_clip` key anymore).
- The "Page snapshot" panel only renders when `metadata.web_clip?.snapshot_storage_path` exists, so it's invisible — that's why you can't click anything to see the rendered page.
- This also affects every Telegram/Discord/SingleFile clip and any field other code paths add to metadata.

### Bug 2 — Hero image is "any image" instead of the page's preview image

The picker's regex for `og:image` requires the attributes in a specific order (`property` before `content`). Many sites — Grammarly included — emit them in a different order or use multi-line tags, so the regex misses, and the function falls through to "first body `<img>` ≥80px", which on Grammarly is a customer-testimonial avatar.

Plus, the candidate picker stops at the first match instead of trying multiple `og:image` tags or comparing them.

---

## Fix

### Change 1 — `supabase/functions/process-note/index.ts` (preserve metadata)

Merge instead of replace. Keep all existing top-level keys and only overwrite the AI-derived ones:

```ts
// line 897-904 area
const existingMeta = (note.metadata as Record<string, unknown> | null) ?? {};
const mergedMetadata = { ...existingMeta, ...metadata };

const updatePayload: Record<string, unknown> = {
  embedding,
  metadata: mergedMetadata,
};
```

This restores `web_clip`, `source`, `is_quick_capture`, and any future per-source fields. The "Page snapshot" iframe panel will start showing immediately on new clips. (Existing clips are already lost — see Backfill below.)

### Change 2 — `supabase/functions/singlefile-capture/index.ts` (better hero picker)

Make the OG/Twitter image regexes order-agnostic and try every match before giving up:

```ts
function findMetaContent(html: string, attrName: string, attrVal: string): string | null {
  // Match <meta ... attrName="attrVal" ... content="..."> OR
  //       <meta ... content="..." ... attrName="attrVal">
  const tagRe = /<meta\b[^>]*>/gi;
  let m: RegExpExecArray | null;
  const wantAttr = new RegExp(`\\b${attrName}\\s*=\\s*["']${attrVal}["']`, "i");
  const contentAttr = /\bcontent\s*=\s*["']([^"']+)["']/i;
  while ((m = tagRe.exec(html)) !== null) {
    const tag = m[0];
    if (wantAttr.test(tag)) {
      const c = tag.match(contentAttr);
      if (c && c[1].trim()) return decodeEntities(c[1]).trim();
    }
  }
  return null;
}

function findHeroImageCandidate(html: string): string | null {
  return (
    findMetaContent(html, "property", "og:image:secure_url") ||
    findMetaContent(html, "property", "og:image:url") ||
    findMetaContent(html, "property", "og:image") ||
    findMetaContent(html, "name", "twitter:image:src") ||
    findMetaContent(html, "name", "twitter:image") ||
    findLinkRel(html, "image_src") ||
    extractFirstBodyImageSrc(html) // last-resort fallback, unchanged
  );
}
```

Also tighten `extractFirstBodyImageSrc`: skip anything inside `<header>`, `<nav>`, or with class/id matching `avatar|logo|icon|tracker|pixel`. (Won't help the lost Grammarly note retroactively, but it'll matter when og:image really is missing.)

### Change 3 — Make the snapshot panel discoverable

Right now the "Page snapshot" panel sits at the bottom of the note view, collapsed, between External-note section and the metadata editor. Two small UX tweaks:

1. **Default open** for SingleFile notes (collapsed elsewhere). The whole point of clipping is to see the page.
2. **Add a button right under the source link** in the body area of web-clip notes that scrolls to / opens the snapshot. Cheaper alternative: render the panel directly under the title instead of at the bottom.

I'll go with: move the `WebClipPreview` component to render *between the title bar and the editor* in `NoteEditor.tsx`, default-open, ~600 px tall. That makes the visual page the first thing you see.

### Change 4 — Backfill existing web clips

For notes that already lost their `web_clip` metadata, write a one-shot SQL script you can run from the migration tool that re-derives `snapshot_storage_path` and `hero_image_attachment` from `note_attachments`:

```sql
update notes n
set metadata = coalesce(n.metadata, '{}'::jsonb) || jsonb_build_object(
  'web_clip', jsonb_build_object(
    'snapshot_attachment', snap.filename,
    'snapshot_storage_path', snap.storage_path,
    'hero_image_attachment', hero.filename,
    'hero_image_storage_path', hero.storage_path,
    'url', n.source_url,
    'hostname', regexp_replace(split_part(n.source_url, '/', 3), '^www\.', '')
  )
)
from (
  select user_id, filename, storage_path
  from note_attachments
  where source = 'singlefile' and mime_type = 'text/html'
) snap
left join (
  select user_id, filename, storage_path
  from note_attachments
  where source = 'singlefile' and mime_type like 'image/%'
) hero on hero.user_id = snap.user_id
       and hero.filename like (regexp_replace(snap.filename, '\.html?$', '') || '%')
where n.source_app = 'singlefile'
  and (n.metadata->'web_clip') is null
  and snap.user_id = n.user_id
  and snap.storage_path like (n.user_id::text || '/%');
```

The matching by user + filename prefix is approximate — for clips where multiple snapshots collide we'll just pick one. That's acceptable for a one-time recovery.

---

## Out of scope

- Replacing the iframe with a server-rendered PNG screenshot (would need Firecrawl or headless Chromium — much heavier; the iframe gives the same visual fidelity from the data we already have).
- Re-running AI extraction on every existing clip — only the metadata-merge fix is needed going forward.

## Summary

After this lands:

1. New web clips show the `og:image` (Grammarly's actual blue brand banner, not a testimonial avatar).
2. New web clips show a fully-rendered, scrollable preview of the saved page right under the title — that's your "see the whole website" visual.
3. Old clips can be repaired with the SQL backfill so their snapshots become visible too (the underlying HTML attachments are still in storage).
