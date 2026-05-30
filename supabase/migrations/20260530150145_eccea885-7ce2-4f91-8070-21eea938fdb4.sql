-- 1) Dedupe media_analysis: pro (user_id, note_id, storage_path, page_number)
-- behalte beste Zeile: complete > processing/pending > failed; danach neuester updated_at/created_at
WITH ranked AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY user_id, note_id, storage_path, COALESCE(page_number, -1)
      ORDER BY
        CASE analysis_status
          WHEN 'complete' THEN 1
          WHEN 'processing' THEN 2
          WHEN 'pending' THEN 3
          WHEN 'failed' THEN 4
          ELSE 5
        END,
        COALESCE(updated_at, created_at) DESC NULLS LAST
    ) AS rn
  FROM public.media_analysis
)
DELETE FROM public.media_analysis ma
USING ranked r
WHERE ma.id = r.id AND r.rn > 1;

-- 2) Unique-Index — NULLS NOT DISTINCT, damit page_number=NULL als gleich gilt
CREATE UNIQUE INDEX IF NOT EXISTS media_analysis_unique_page
  ON public.media_analysis (user_id, note_id, storage_path, page_number)
  NULLS NOT DISTINCT;

-- 3) Lookup-Index für Library-Queries
CREATE INDEX IF NOT EXISTS media_analysis_user_note_path_idx
  ON public.media_analysis (user_id, note_id, storage_path);