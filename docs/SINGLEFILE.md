# SingleFile Web Clipper

Capture full webpages from Chrome straight into Menerio as searchable notes,
with the original page snapshot preserved as an attachment.

## How it works

1. The [SingleFile Chrome extension](https://chromewebstore.google.com/detail/singlefile/mpiodijhokgodhhofbcjdecpffjipkle)
   saves the current page as a single self-contained HTML file.
2. SingleFile is configured to upload that file to Menerio's REST endpoint.
3. Menerio's `singlefile-capture` Edge Function:
   - authenticates the request with a Hub API key (Bearer `mnr_…`),
   - validates the upload (HTML, ≤ 20 MB),
   - extracts the title, description and readable text,
   - stores the original HTML snapshot in the `note-attachments` bucket,
   - creates a Markdown note with the readable text + a wikilink to the snapshot,
   - tags the note with `source_app="singlefile"` so it shows the **Web Clipper** badge.

## Endpoint

```
POST https://<your-supabase-url>/functions/v1/singlefile-capture
Authorization: Bearer mnr_YOUR_API_KEY
Content-Type: multipart/form-data
```

### Form fields

| Field    | Required | Description |
|----------|----------|-------------|
| `file`   | yes      | The HTML snapshot produced by SingleFile. |
| `url`    | no       | Original page URL. Auto-detected from the snapshot if omitted. |
| `title`  | no       | Overrides the page `<title>`. |
| `tags`   | no       | Comma-separated tag list (max 20). Defaults to `web-clip`. |
| `folder` | no       | Folder path. Defaults to `Web Clips`. |

### Response

```json
{
  "ok": true,
  "noteId": "…",
  "title": "…",
  "sourceUrl": "https://example.com/article"
}
```

### Status codes

| Code | Meaning |
|------|---------|
| 201  | Note created. |
| 400  | Missing/invalid upload. |
| 401  | Missing or invalid API key. |
| 403  | API key lacks the `notes` scope. |
| 413  | File larger than 20 MB. |
| 429  | Rate limit (1000 req/h per key). |
| 500  | Unexpected failure. |

## Configuring SingleFile

1. Open the **Settings → Web Clipper** tab in Menerio and copy the values.
2. In Chrome, click the SingleFile toolbar icon → ⚙️ **Options**.
3. Scroll to **Destination** and enable **upload to a REST Form API**.
4. Fill in the dialog as follows:

   | SingleFile field            | Value                                                    |
   |-----------------------------|----------------------------------------------------------|
   | **secret key**              | *Leave empty.* Menerio doesn't use SingleFile's shared-secret signing — the API key in the authorization token is what authenticates the request. |
   | **URL**                     | `https://<your-supabase-url>/functions/v1/singlefile-capture` |
   | **authorization token**     | `Bearer mnr_YOUR_API_KEY` *(include the literal `Bearer ` prefix and the trailing space)* |
   | **archive data field name** | `file` — the form field that carries the HTML snapshot. Must match Menerio's `file` field. |
   | **archive URL field name**  | `url` — the form field that carries the original page URL. Must match Menerio's `url` field so the source link is recorded. |

5. (Optional) Add extra fields under SingleFile's **extra HTTP headers / fields**
   section, e.g. `tags=research,inspiration` or `folder=Reading List`.
6. Save the options and capture pages as usual — each capture becomes a note.

## Security model

- Authentication uses the existing **Hub API key** system (`mnr_` prefix,
  SHA-256 hashed at rest, scoped, rate-limited to 1000 req/h per key).
- Uploaded HTML is **never executed** in the Menerio app; it is stored as a
  binary attachment in the private `note-attachments` bucket and only fetched
  via short-lived signed URLs.
- The note body contains plain Markdown — no raw HTML — so the Tiptap editor
  cannot evaluate scripts from clipped pages.
- Inline scripts, styles and `<noscript>`/`<svg>` blocks are stripped during
  text extraction so they never reach the search index.

## Generating an API key

Settings → **API Keys** → **Generate new API key**. Give it a name (e.g.
"SingleFile") and enable the `notes` scope. Copy the `mnr_…` value once —
it isn't shown again — and paste it into SingleFile.
