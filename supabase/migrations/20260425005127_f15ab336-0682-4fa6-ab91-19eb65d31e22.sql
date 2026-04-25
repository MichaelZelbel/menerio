CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA extensions;

ALTER TABLE public.contacts
  ADD COLUMN IF NOT EXISTS conversation_context text,
  ADD COLUMN IF NOT EXISTS conversation_intent text,
  ADD COLUMN IF NOT EXISTS conversation_preset_tone text,
  ADD COLUMN IF NOT EXISTS conversation_custom_tone text,
  ADD COLUMN IF NOT EXISTS conversation_updated_at timestamp with time zone;

CREATE TABLE IF NOT EXISTS public.conversation_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  person_id uuid NOT NULL,
  role text NOT NULL,
  content text NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT conversation_messages_role_check CHECK (role IN ('user', 'assistant'))
);

CREATE INDEX IF NOT EXISTS idx_conversation_messages_user_person_created
  ON public.conversation_messages (user_id, person_id, created_at);

ALTER TABLE public.conversation_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own conversation messages"
  ON public.conversation_messages
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can create their own conversation messages"
  ON public.conversation_messages
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE TABLE IF NOT EXISTS public.person_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  person_id uuid NOT NULL,
  title text NOT NULL DEFAULT '',
  doc_type text NOT NULL DEFAULT 'other',
  content text NOT NULL DEFAULT '',
  memory_type text NOT NULL DEFAULT 'long_term',
  embedding extensions.vector(768),
  embedding_updated_at timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT person_documents_memory_type_check CHECK (memory_type IN ('short_term', 'long_term')),
  CONSTRAINT person_documents_doc_type_check CHECK (doc_type IN ('journal', 'chat-notes', 'reflections', 'other'))
);

CREATE INDEX IF NOT EXISTS idx_person_documents_user_person
  ON public.person_documents (user_id, person_id);

CREATE INDEX IF NOT EXISTS idx_person_documents_memory_type
  ON public.person_documents (user_id, person_id, memory_type);

ALTER TABLE public.person_documents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own person documents"
  ON public.person_documents
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can create their own person documents"
  ON public.person_documents
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own person documents"
  ON public.person_documents
  FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete their own person documents"
  ON public.person_documents
  FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

DROP TRIGGER IF EXISTS update_person_documents_updated_at ON public.person_documents;
CREATE TRIGGER update_person_documents_updated_at
  BEFORE UPDATE ON public.person_documents
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_updated_at();

CREATE OR REPLACE FUNCTION public.match_person_documents(
  query_embedding extensions.vector(768),
  match_person_id uuid,
  match_user_id uuid,
  match_threshold double precision DEFAULT 0.3,
  match_count integer DEFAULT 5
)
RETURNS TABLE (
  id uuid,
  title text,
  content text,
  similarity double precision
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  RETURN QUERY
  SELECT
    pd.id,
    pd.title,
    pd.content,
    (1 - (pd.embedding <=> query_embedding))::double precision AS similarity
  FROM public.person_documents pd
  WHERE pd.user_id = match_user_id
    AND pd.person_id = match_person_id
    AND pd.memory_type = 'long_term'
    AND pd.embedding IS NOT NULL
    AND (1 - (pd.embedding <=> query_embedding))::double precision > match_threshold
  ORDER BY pd.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;