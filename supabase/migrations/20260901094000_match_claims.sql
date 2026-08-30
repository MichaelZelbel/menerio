-- Claims become findable by meaning.
--
-- Until now the structured layer was invisible to search: search_brain looks
-- at notes and Lexicon pages, both prose, and claims were reachable only by
-- asking get_claims for a subject you already knew. A fact store nothing
-- searches is a filing cabinet nobody opens.
--
-- THE VALIDITY FILTER IS IN THE WHERE CLAUSE, NOT IN A RE-RANK. That is the
-- whole point of this function. A superseded fact must not be able to win on
-- similarity: measured in arXiv 2606.26511, retrieval that pulls both values
-- and ranks them serves the stale one 15% to 40% of the time, while a
-- deterministic filter serves it 0%.
--
-- p_as_of answers all three questions with one function and no branch:
--   CURRENT_DATE  -> what is true now
--   an older date -> what was believed then
--   (events are a different table entirely, so "what happened" needs nothing here)
--
-- Types follow the house pattern from match_note_chunks
-- (20260509120141_c48a970d...sql): extensions.vector, and the distance
-- operator spelled operator(extensions.<=>) because the extension is not on
-- the function's search_path.

ALTER TABLE public.claims
  ADD COLUMN IF NOT EXISTS embedding extensions.vector(1536);

COMMENT ON COLUMN public.claims.embedding IS
  'Embedding of the evidence quote when there is one, else "attribute: value".
   The quote is what a person would actually search with; the bare triple is
   three or four words and matches badly.';

CREATE INDEX IF NOT EXISTS claims_embedding_idx
  ON public.claims USING ivfflat (embedding extensions.vector_cosine_ops)
  WITH (lists = 100);

CREATE OR REPLACE FUNCTION public.match_claims(
  query_embedding extensions.vector,
  match_threshold double precision DEFAULT 0.2,
  match_count integer DEFAULT 20,
  p_user_id uuid DEFAULT auth.uid(),
  p_as_of date DEFAULT CURRENT_DATE
)
RETURNS TABLE (
  id uuid,
  subject_type text,
  subject_id uuid,
  attribute text,
  value text,
  valid_from date,
  valid_to date,
  confidence text,
  cardinality text,
  review_by date,
  evidence_quote text,
  source_type text,
  source_id uuid,
  similarity double precision
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  RETURN QUERY
  SELECT
    c.id,
    c.subject_type,
    c.subject_id,
    c.attribute,
    c.value,
    c.valid_from,
    c.valid_to,
    c.confidence,
    c.cardinality,
    c.review_by,
    c.evidence_quote,
    c.source_type,
    c.source_id,
    (1 - (c.embedding operator(extensions.<=>) query_embedding))::float AS similarity
  FROM public.claims c
  WHERE c.user_id = p_user_id
    AND c.embedding IS NOT NULL
    -- The hard exclusion. Not a preference, not a penalty: a claim that had
    -- stopped being true by p_as_of never enters the candidate set at all.
    AND (c.valid_from IS NULL OR c.valid_from <= p_as_of)
    AND (c.valid_to   IS NULL OR c.valid_to   >  p_as_of)
    AND (1 - (c.embedding operator(extensions.<=>) query_embedding)) > match_threshold
  ORDER BY c.embedding operator(extensions.<=>) query_embedding
  LIMIT match_count;
END;
$$;

GRANT EXECUTE ON FUNCTION public.match_claims TO authenticated, service_role;
