-- A fact about a contact the user hid from AI must not come back from search.
--
-- WHY (found 2026-08-31, while building the promotion path). Until now every
-- claim was about the user themselves, so the question never arose. The
-- promotion path is about to write claims whose subject is a contact, and
-- `match_claims` filtered on user_id and validity and nothing else.
--
-- Contacts carry two controls the user sets by hand:
--   is_sensitive     -> get_contact_profile refuses to show any profile fact
--   ai_visibility    -> every other read path filters on 'visible'
--
-- Both are enforced on `contacts` and on `profile_entries` and neither was
-- enforced on `claims`. Promoting a hidden contact's facts into claims would
-- have built a search path straight around a control the user set, and it
-- would have looked like a feature: the assistant suddenly knowing more.
--
-- The promotion path refuses to write those rows in the first place
-- (_shared/promote-entries.ts, reason "contact-hidden-from-ai"). This is the
-- second half of the same rule, in the database, where it also covers a
-- contact that is hidden AFTER its facts were promoted — which the write-time
-- check by construction cannot.
--
-- Claims about the user themselves (subject_type = 'self') are untouched:
-- there is no contact row to consult and they are the user's own facts.

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
    -- The new clause. A claim about a contact is only visible while that
    -- contact is. Written as NOT EXISTS rather than a join so a claim whose
    -- subject_id points at a deleted contact disappears too, instead of
    -- surviving as an unattributable fact about nobody.
    AND (
      c.subject_type <> 'contact'
      OR EXISTS (
        SELECT 1 FROM public.contacts ct
        WHERE ct.id = c.subject_id
          AND ct.user_id = p_user_id
          AND ct.merged_into IS NULL
          AND ct.is_sensitive IS NOT TRUE
          AND ct.ai_visibility = 'visible'
      )
    )
    AND (1 - (c.embedding operator(extensions.<=>) query_embedding)) > match_threshold
  ORDER BY c.embedding operator(extensions.<=>) query_embedding
  LIMIT match_count;
END;
$$;

GRANT EXECUTE ON FUNCTION public.match_claims TO authenticated, service_role;
