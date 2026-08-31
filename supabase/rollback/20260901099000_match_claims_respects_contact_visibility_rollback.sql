-- Rollback for 20260901099000_match_claims_respects_contact_visibility.sql
--
-- ORDER. Run this FIRST of everything dated 2026-09-01 — before
-- 20260901098000_..._rollback.sql — and note that 096000's rollback rewrites
-- this same function to its own older form, so running 096000's first and this
-- one second would put the newer body back and undo that rollback.
--
-- Full descending order for the date: 099000 (here), 098000, 097000, 096000,
-- 095000, 094000, 093000, 092000, 091000, 090000.
--
-- WHAT THIS COSTS, AND IT IS A PRIVACY REGRESSION. match_claims goes back to
-- filtering on user_id and validity only. A claim whose subject is a contact
-- the user marked `is_sensitive`, or set to an ai_visibility other than
-- 'visible', becomes searchable again — by search_brain, by the in-app
-- assistant's search_claims tool, and by anything else holding an API key with
-- the world scope. Every other read path in the product still honours those
-- two flags, so this reopens exactly one hole and leaves it looking like a
-- feature: the assistant suddenly knowing more.
--
-- Before running it, check what would become visible:
--
--   SELECT count(*) FROM public.claims c
--   JOIN public.contacts ct ON ct.id = c.subject_id
--   WHERE c.subject_type = 'contact'
--     AND (ct.is_sensitive IS TRUE OR ct.ai_visibility <> 'visible');
--
-- If that is not zero, close those claims (give them a valid_to) or delete the
-- rows before rolling back, or the flags stop meaning anything.
--
-- Restored verbatim from 20260901096000_user_timezone_for_validity.sql.

CREATE OR REPLACE FUNCTION public.match_claims(
  query_embedding extensions.vector,
  match_threshold double precision DEFAULT 0.2,
  match_count integer DEFAULT 20,
  p_user_id uuid DEFAULT auth.uid(),
  p_as_of date DEFAULT NULL
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
DECLARE
  as_of date := COALESCE(p_as_of, public.user_today(p_user_id));
BEGIN
  RETURN QUERY
  SELECT
    c.id, c.subject_type, c.subject_id, c.attribute, c.value,
    c.valid_from, c.valid_to, c.confidence, c.cardinality, c.review_by,
    c.evidence_quote, c.source_type, c.source_id,
    (1 - (c.embedding operator(extensions.<=>) query_embedding))::float AS similarity
  FROM public.claims c
  WHERE c.user_id = p_user_id
    AND c.embedding IS NOT NULL
    -- The hard exclusion, asked in the user's own day.
    AND (c.valid_from IS NULL OR c.valid_from <= as_of)
    AND (c.valid_to   IS NULL OR c.valid_to   >  as_of)
    AND (1 - (c.embedding operator(extensions.<=>) query_embedding)) > match_threshold
  ORDER BY c.embedding operator(extensions.<=>) query_embedding
  LIMIT match_count;
END;
$$;

GRANT EXECUTE ON FUNCTION public.match_claims TO authenticated, service_role;
