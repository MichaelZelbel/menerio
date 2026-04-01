
-- Create a match_media RPC function similar to match_notes
-- Searches media_analysis embeddings and returns matching entries with parent note info
CREATE OR REPLACE FUNCTION public.match_media(
  query_embedding extensions.vector,
  match_threshold double precision DEFAULT 0.5,
  match_count integer DEFAULT 10,
  p_user_id uuid DEFAULT auth.uid()
)
RETURNS TABLE(
  id uuid,
  note_id uuid,
  note_title text,
  storage_path text,
  media_type text,
  page_number integer,
  original_filename text,
  description text,
  extracted_text text,
  topics text[],
  raw_analysis jsonb,
  similarity double precision,
  created_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  RETURN QUERY
  SELECT
    ma.id,
    ma.note_id,
    n.title AS note_title,
    ma.storage_path,
    ma.media_type,
    ma.page_number,
    ma.original_filename,
    ma.description,
    ma.extracted_text,
    ma.topics,
    ma.raw_analysis,
    (1 - (ma.embedding operator(extensions.<=>) query_embedding))::float AS similarity,
    ma.created_at
  FROM public.media_analysis ma
  JOIN public.notes n ON n.id = ma.note_id
  WHERE ma.user_id = p_user_id
    AND ma.analysis_status = 'complete'
    AND ma.embedding IS NOT NULL
    AND (1 - (ma.embedding operator(extensions.<=>) query_embedding))::float > match_threshold
  ORDER BY ma.embedding operator(extensions.<=>) query_embedding
  LIMIT match_count;
END;
$$;
