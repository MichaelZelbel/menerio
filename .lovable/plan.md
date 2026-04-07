

## Add OCR/Media Analysis Context to AI Chat

### Problem
The `note-chat` edge function builds note context from `notes.title`, `notes.content`, `notes.tags`, and `notes.metadata` only. It does not query the `media_analysis` table, so the AI has no access to OCR-extracted text, image descriptions, or topics from embedded media. When a user asks about text visible in an image or PDF, the AI cannot answer.

### Change

**File: `supabase/functions/note-chat/index.ts`**

After fetching the note (line ~347), add a query to fetch all `media_analysis` entries for the note:

```sql
SELECT storage_path, media_type, page_number, original_filename,
       extracted_text, description, topics
FROM media_analysis
WHERE note_id = $note_id
ORDER BY page_number ASC NULLS FIRST
```

Then append the media analysis data to the `noteContext` string that gets injected into the system prompt. Format it as a readable block:

```
--- MEDIA ANALYSIS ---
File: marriage-certificate.pdf (pdf)
  Description: A German marriage certificate...
  Topics: Marriage, Legal Documents, Germany
  Page 1 extracted text:
    3. Kinder: ...
  Page 2 extracted text:
    ...
--- END MEDIA ANALYSIS ---
```

This way the LLM sees all OCR text and descriptions alongside the note content, enabling it to answer questions about text in images/PDFs.

### Also add a `search_media_text` tool

Add a new tool definition that lets the AI search across `media_analysis.extracted_text` for all of the user's notes — not just the current one. This enables cross-note OCR search when the current note's media doesn't contain the answer.

Tool implementation: query `media_analysis` joined with `notes` filtering by `user_id`, using `ILIKE` on `extracted_text` and `description`.

### Files to change
- `supabase/functions/note-chat/index.ts` — fetch media_analysis for current note context + add search_media_text tool

### Scope
Single file change, one edge function redeploy.

