---
name: SingleFile Web Clipper
description: SingleFile Chrome extension uploads webpages via singlefile-capture Edge Function (mnr_ Bearer, multipart, notes scope). Creates Markdown note + HTML snapshot attachment, source_app="singlefile".
type: integration
---

- Endpoint: `POST /functions/v1/singlefile-capture`, multipart/form-data, mnr_ Bearer auth via existing `hub-auth` (requires `notes` scope), 1000/h rate limit.
- Form fields: `file` (required HTML), `url`, `title`, `tags` (comma-separated), `folder` (defaults `Web Clips`).
- Storage: HTML snapshot uploaded to `note-attachments` bucket, registered in `note_attachments` with `source='singlefile'`.
- Note body: Markdown with source link, meta description, wikilink `[[<filename>.html]]` to snapshot, then extracted plain text (≤50k chars).
- Note metadata: `source_app='singlefile'`, `source_url`, `metadata.web_clip` with snapshot path/url/hostname/captured_at.
- Settings UI: `src/components/settings/SingleFileIntegration.tsx`, Settings tab `value="singlefile"` (Globe icon).
- Docs: `docs/SINGLEFILE.md`.
- Source badge "singlefile" surfaces in existing NoteEditor / ExternalNotePanel UI via `source_app`.
