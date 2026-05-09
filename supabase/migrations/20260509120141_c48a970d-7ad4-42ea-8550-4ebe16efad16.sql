
-- Smart Chunking storage for note embeddings
CREATE TABLE public.note_chunks (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  note_id UUID NOT NULL REFERENCES public.notes(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  chunk_index INTEGER NOT NULL,
  heading_path TEXT,
  content TEXT NOT NULL,
  token_count INTEGER NOT NULL DEFAULT 0,
  embedding extensions.vector(1536),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (note_id, chunk_index)
);

CREATE INDEX idx_note_chunks_user ON public.note_chunks(user_id);
CREATE INDEX idx_note_chunks_note ON public.note_chunks(note_id, chunk_index);
CREATE INDEX idx_note_chunks_embedding
  ON public.note_chunks
  USING hnsw (embedding extensions.vector_cosine_ops);

ALTER TABLE public.note_chunks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own note chunks"
  ON public.note_chunks
  FOR ALL
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Admins can view all note chunks"
  ON public.note_chunks
  FOR SELECT
  TO authenticated
  USING (public.is_admin(auth.uid()));

-- Top-K vector search across a user's chunks
CREATE OR REPLACE FUNCTION public.match_note_chunks(
  query_embedding extensions.vector,
  match_threshold double precision DEFAULT 0.25,
  match_count integer DEFAULT 20,
  p_user_id uuid DEFAULT auth.uid()
)
RETURNS TABLE (
  chunk_id uuid,
  note_id uuid,
  chunk_index integer,
  heading_path text,
  content text,
  similarity double precision,
  note_title text,
  note_created_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  RETURN QUERY
  SELECT
    nc.id AS chunk_id,
    nc.note_id,
    nc.chunk_index,
    nc.heading_path,
    nc.content,
    (1 - (nc.embedding operator(extensions.<=>) query_embedding))::float AS similarity,
    n.title AS note_title,
    n.created_at AS note_created_at
  FROM public.note_chunks nc
  JOIN public.notes n ON n.id = nc.note_id
  WHERE nc.user_id = p_user_id
    AND n.is_trashed = false
    AND nc.embedding IS NOT NULL
    AND (1 - (nc.embedding operator(extensions.<=>) query_embedding))::float > match_threshold
  ORDER BY nc.embedding operator(extensions.<=>) query_embedding
  LIMIT match_count;
END;
$$;
