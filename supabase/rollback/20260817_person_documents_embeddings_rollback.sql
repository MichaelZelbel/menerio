-- Rollback for 20260817140000_person_documents_real_embeddings.sql
--
-- NOT a migration. Kept outside supabase/migrations/ deliberately: a past session
-- committed destructive SQL into that folder, where a rebuild would have run it.
-- Nothing here runs automatically. Copy the part you need.
--
-- Read this before you use it: rolling back restores FABRICATED vectors. The
-- values this file puts back were invented by a chat model and retrieve noise.
-- The only thing a rollback buys is the previous behaviour, not anything of
-- value. If the concern is that the new path is broken, prefer leaving the column
-- empty (search returns nothing) over refilling it with numbers that look like
-- recall and are not.

-- ---------------------------------------------------------------------------
-- STEP 1, BEFORE APPLYING THE MIGRATION: capture the pre-change state.
-- Without this there is nothing to roll back to, because the migration drops the
-- column. Save the output of both queries somewhere outside the database.
-- ---------------------------------------------------------------------------

-- 1a. The vectors themselves, as text, one row per document.
--     select id, user_id, person_id, memory_type, embedding_updated_at,
--            embedding::text as embedding_text
--     from public.person_documents
--     where embedding is not null
--     order by id;

-- 1b. The exact current definition of the function, so the restore below can be
--     checked against what was really there rather than against this file.
--     select pg_get_functiondef(p.oid)
--     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--     where n.nspname = 'public' and p.proname = 'match_person_documents';

-- 1c. Row counts, to verify the restore put back what was taken.
--     select count(*) as total, count(embedding) as with_embedding
--     from public.person_documents;

-- ---------------------------------------------------------------------------
-- STEP 2: undo the schema change.
-- ---------------------------------------------------------------------------

DROP FUNCTION IF EXISTS public.match_person_documents(
  extensions.vector(1536), uuid, uuid, double precision, integer
);

ALTER TABLE public.person_documents DROP COLUMN IF EXISTS embedding;
ALTER TABLE public.person_documents ADD COLUMN embedding extensions.vector(768);

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

-- ---------------------------------------------------------------------------
-- STEP 3: reload the captured vectors from the STEP 1a output.
-- One statement per row, built from the saved id and embedding_text:
--
--   update public.person_documents
--   set embedding = '<embedding_text>'::extensions.vector(768),
--       embedding_updated_at = '<saved timestamp>'
--   where id = '<saved id>';
--
-- Then re-run 1c and compare the counts against what you saved.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- Also roll back the code, or the next embed-document call writes a 1536-dim
-- vector into a 768 column and fails:
--   git revert <the Phase 2 commit>, then redeploy embed-document,
--   search-documents and conversation-chat.
-- ---------------------------------------------------------------------------
