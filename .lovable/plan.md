
## Image & PDF Intelligence Pipeline

### 1. Database Migration — `media_analysis` table
- Create `media_analysis` table with columns: `user_id`, `note_id`, `storage_path`, `media_type`, `page_number`, `original_filename`, `extracted_text`, `description`, `topics`, `raw_analysis`, `embedding` (vector 1536), `analysis_status`, `error_message`
- RLS: users can view/manage own rows; admins can view all
- Indexes on `note_id`, `user_id`, `analysis_status`, and HNSW on embedding

### 2. Edge Function: `analyze-media`
- Accepts `note_id`, `storage_path`, `media_type`, optional `page_number`
- Downloads file from Supabase Storage, converts to base64
- Sends to vision LLM via OpenRouter (`openai/gpt-4o-mini` with vision) using `chatWithCredits` for credit enforcement
- Vision prompt extracts: `extracted_text`, `description`, `topics`, `content_type`
- Generates embedding of combined text via `getEmbeddingWithCredits`
- Stores result in `media_analysis` table (status: complete/failed)
- Uses `EdgeRuntime.waitUntil` for background processing

### 3. Edge Function: `analyze-pdf`
- Accepts `note_id` and `storage_path`
- In Deno edge functions, full PDF-to-image conversion is limited. Instead:
  - Use `pdf-lib` to extract page count
  - Send the full PDF as a document to the vision LLM (gpt-4o-mini supports PDFs via base64)
  - For multi-page PDFs, process page-by-page if the model supports it, or process as a single document
- Stores per-page or whole-document entries in `media_analysis`
- Creates combined embedding from all extracted content

### 4. Update `process-note` to include media content
- After media analysis completes, the note's embedding should incorporate media-derived text
- In `process-note`, gather all `media_analysis` entries for the note (status=complete)
- Append their `extracted_text` and `description` to the note text before embedding
- Merge media `topics` into note `metadata.topics`

### 5. Frontend: trigger analysis on upload + processing indicator
- Modify `FileUploadHandler.ts` to call `analyze-media` (or `analyze-pdf`) after successful upload
- Add a subtle processing indicator (pulsing border) on images/PDFs while analysis is pending
- No blocking — user continues editing while analysis runs in background

### Files changed
- New migration: `media_analysis` table + RLS + indexes
- New: `supabase/functions/analyze-media/index.ts`
- New: `supabase/functions/analyze-pdf/index.ts`
- Modified: `supabase/functions/process-note/index.ts` — include media content in embedding
- Modified: `src/components/notes/extensions/FileUploadHandler.ts` — trigger analysis after upload
- Modified: `supabase/config.toml` — add new functions with `verify_jwt = false`
- UI: Add processing indicator styling for images/PDFs being analyzed
