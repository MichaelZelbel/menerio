-- Rollback for 20260901096000_user_timezone_for_validity.sql
--
-- ORDER. SECOND of the four 2026-09-01 rollbacks, run in descending number:
-- 097000, then this, then 095000, then 094000. It must run BEFORE 094000's
-- rollback, which drops match_claims outright — this one rebuilds that
-- function, so running it afterwards would resurrect a function 094000's
-- rollback was meant to remove.
--
-- WHAT THIS COSTS, AND IT IS A REGRESSION. match_claims goes back to
-- defaulting p_as_of to CURRENT_DATE, which is UTC. A user east of UTC then
-- loses every fact they record late in the evening until UTC catches up: at
-- UTC+2, a claim written at 22:30 local carries valid_from = tomorrow's date
-- by the user's calendar, fails `valid_from <= CURRENT_DATE`, and is invisible
-- to search for ninety minutes. Nothing errors and nothing warns. This was
-- found on 2026-08-31 at 00:28 Berlin with two freshly written claims that had
-- been recorded correctly and could not be found.
--
-- CALLERS MUST BE ROLLED BACK TOO. Both callers now pass p_as_of: null
-- meaning "use my own day" — menerio-mcp's searchClaims and the chat
-- functions' searchClaims in _shared/read-tools.ts. Against this older
-- function NULL is not "use my day"; it is a NULL compared against
-- valid_from, every comparison returns NULL, and the WHERE clause drops
-- EVERY ROW. Search returns nothing at all, silently. Deploy code that passes
-- an explicit date (or omits the argument) BEFORE running this.

DROP FUNCTION IF EXISTS public.match_claims(
  extensions.vector, double precision, integer, uuid, date
);

-- Restored verbatim from 20260901094000_match_claims.sql.
CREATE FUNCTION public.match_claims(
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
    c.id, c.subject_type, c.subject_id, c.attribute, c.value,
    c.valid_from, c.valid_to, c.confidence, c.cardinality, c.review_by,
    c.evidence_quote, c.source_type, c.source_id,
    (1 - (c.embedding operator(extensions.<=>) query_embedding))::float AS similarity
  FROM public.claims c
  WHERE c.user_id = p_user_id
    AND c.embedding IS NOT NULL
    AND (c.valid_from IS NULL OR c.valid_from <= p_as_of)
    AND (c.valid_to   IS NULL OR c.valid_to   >  p_as_of)
    AND (1 - (c.embedding operator(extensions.<=>) query_embedding)) > match_threshold
  ORDER BY c.embedding operator(extensions.<=>) query_embedding
  LIMIT match_count;
END;
$$;

GRANT EXECUTE ON FUNCTION public.match_claims TO authenticated, service_role;

DROP FUNCTION IF EXISTS public.user_today(uuid);

-- profiles.timezone IS DELIBERATELY LEFT IN PLACE.
--
-- The other rollbacks in this set drop the columns their migration added,
-- because those columns hold values a machine computed and a machine can
-- recompute. This one does not: timezone holds a setting the USER chose, and
-- re-running the migration cannot recover it — the column comes back
-- defaulted to 'UTC' for everyone. On 2026-08-31 exactly one of eleven
-- profiles had set a real value (Europe/Berlin); dropping the column would
-- silently move that person back to UTC and reintroduce the very bug this
-- migration fixed, on the next roll-forward.
--
-- A NOT NULL column defaulting to 'UTC' that nothing reads costs nothing.
-- Uncomment this only when deliberately discarding every user's timezone:
--
-- ALTER TABLE public.profiles DROP COLUMN IF EXISTS timezone;
