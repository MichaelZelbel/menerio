-- A fact stated late in the evening must not vanish until UTC catches up.
--
-- WHY (found by testing, 2026-08-31 00:28 Berlin): match_claims defaulted
-- p_as_of to CURRENT_DATE, which is UTC. The server was still on 2026-08-30
-- while the user's own date was already the 31st, so two claims he had just
-- stated, correctly recorded with valid_from = 2026-08-31, failed the
-- `valid_from <= p_as_of` test and were invisible to search.
--
-- The window is not small. For a user at UTC+2 every fact recorded between
-- 22:00 and midnight local disappears for up to two hours; further east it is
-- worse. Nothing errors, nothing warns: search simply returns fewer facts and
-- the caller concludes the data was never saved. That is the same silent-
-- absence failure the hub has been bitten by before.
--
-- The fix is to ask the question in the user's own day rather than in UTC.
-- Default 'UTC' keeps every existing user exactly where they are.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS timezone text NOT NULL DEFAULT 'UTC';

COMMENT ON COLUMN public.profiles.timezone IS
  'IANA timezone, e.g. Europe/Berlin. Decides which calendar day "today" means
   when judging whether a dated fact is currently valid.';

/** The user's own current date. Falls back to UTC for an unknown timezone. */
CREATE OR REPLACE FUNCTION public.user_today(p_user_id uuid)
RETURNS date
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  tz text;
BEGIN
  SELECT timezone INTO tz FROM public.profiles WHERE id = p_user_id;
  IF tz IS NULL OR tz = '' THEN
    RETURN (now() AT TIME ZONE 'UTC')::date;
  END IF;
  -- An invalid IANA name raises rather than returning nonsense, so a typo in
  -- a profile can never silently shift every date by a day.
  BEGIN
    RETURN (now() AT TIME ZONE tz)::date;
  EXCEPTION WHEN others THEN
    RETURN (now() AT TIME ZONE 'UTC')::date;
  END;
END;
$$;

GRANT EXECUTE ON FUNCTION public.user_today TO authenticated, service_role;

-- Rebuild match_claims so p_as_of defaults to the caller's own day.
-- NULL is now the "use my day" value, because a DEFAULT cannot reference the
-- function's own p_user_id argument.
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
