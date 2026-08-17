-- Defect 2: person_documents.embedding held vectors invented by a chat model.
--
-- embed-document, search-documents and conversation-chat each carried an
-- identical `generateEmbedding` that posted to the Lovable CHAT gateway with
-- google/gemini-2.5-flash-lite and asked, in prose, for "a 768-dimensional
-- semantic embedding vector", taking whatever numbers came back through a forced
-- tool call. It then sliced to 768, padded short output with zeros and divided by
-- the magnitude. A language model cannot produce a meaningful embedding by
-- emitting numbers as text, so every one of those vectors was invented. The
-- padding and the normalising are what hid it: the output was always a unit
-- vector of exactly the right dimension, so nothing downstream ever errored and
-- no log line ever complained.
--
-- embed-document was the ONLY writer of this column, so every value in it is
-- fabricated. match_person_documents compared a fabricated stored vector against
-- an equally fabricated query vector, which is noise against noise, so document
-- search and Mira's long-term memory recall have been returning arbitrary rows
-- for as long as the feature has existed.
--
-- The fix reuses the embedding path this codebase already had and already used
-- correctly for note chunks: getEmbeddingWithCredits, which calls OpenRouter with
-- openai/text-embedding-3-small. That model is 1536-dimensional, so the column
-- and the RPC signature move from 768 to 1536.
--
-- Why 1536 rather than keeping 768 with a different model:
--   1. getEmbeddingWithCredits hardcodes text-embedding-3-small. A 768-dim model
--      would need a second embedding helper and would put the app in two
--      different vector spaces.
--   2. note_chunks.embedding is already vector(1536) with a working HNSW index,
--      so 1536 is proven in this database and everything ends up in one space.
--   3. person_documents has NO vector index, only btree on (user_id, person_id)
--      and (user_id, person_id, memory_type). There is nothing to rebuild, so the
--      usual cost of a dimension change does not apply here.
--
-- The existing values are DROPPED rather than migrated, because they are
-- worthless and keeping them would leave the search broken after the "fix".
-- Between this migration and the backfill, match_person_documents returns
-- nothing, because it already filters `embedding IS NOT NULL`. That gap is an
-- improvement: returning nothing is better than returning noise that reads like
-- recall.
--
-- DEPLOY THE EDGE FUNCTIONS BEFORE APPLYING THIS. If this lands first,
-- embed-document writes a 768-dim vector into a 1536 column and errors.
--
-- Rollback: supabase/rollback/20260817_person_documents_embeddings_rollback.sql
-- Capture the pre-change state FIRST; the rollback file says how.

-- The argument type is part of the signature, so the old function must go before
-- the column type changes underneath it.
DROP FUNCTION IF EXISTS public.match_person_documents(
  extensions.vector(768), uuid, uuid, double precision, integer
);

ALTER TABLE public.person_documents DROP COLUMN IF EXISTS embedding;
ALTER TABLE public.person_documents ADD COLUMN embedding extensions.vector(1536);

-- Every remaining timestamp refers to a fabricated vector that no longer exists.
UPDATE public.person_documents
SET embedding_updated_at = NULL
WHERE embedding_updated_at IS NOT NULL;

CREATE OR REPLACE FUNCTION public.match_person_documents(
  query_embedding extensions.vector(1536),
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
