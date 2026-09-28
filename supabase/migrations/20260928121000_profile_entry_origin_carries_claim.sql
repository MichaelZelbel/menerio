-- A profile row that DISPLAYS an existing claim may carry that claim's
-- "unverified" origin over.
--
-- profile_entry_require_origin refuses new "unverified" rows because that
-- word marks legacy facts nobody vouched for, and a new automated fact must
-- bring its own verbatim quote instead. promote-profile-entries now gives
-- every live claim a row on the profile (migration 20260928120000 and
-- _shared/adopt-claims.ts). Hundreds of claims were written by agents before
-- quotes were required, so their row can honestly be neither "ai_note" (it has
-- no quote) nor "user_manual" (nobody typed it). "unverified" is the truth,
-- inherited from the claim, not a new fact slipping past the rule. Only a row
-- linked to a claim that is itself unverified, or that has no quote, gets the
-- exception.
CREATE OR REPLACE FUNCTION public.profile_entry_require_origin()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  allowed text[] := ARRAY['user_manual','unverified','ai_note','ai_moment','ai_lexicon','review_queue','import','mcp','api','normalizer'];
BEGIN
  IF NEW.origin IS NULL OR NOT (NEW.origin = ANY(allowed)) THEN
    RAISE EXCEPTION 'profile_entry_origin_required: unknown origin %', COALESCE(NEW.origin, 'NULL');
  END IF;

  IF TG_OP = 'INSERT' AND NEW.origin = 'unverified' AND NOT (
    NEW.derived_from_claim_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.claims k
       WHERE k.id = NEW.derived_from_claim_id
         AND k.user_id = NEW.user_id
         AND (k.origin IN ('unverified', 'menerio')
              OR length(btrim(coalesce(k.evidence_quote, ''))) < 10)
    )
  ) THEN
    RAISE EXCEPTION 'profile_entry_origin_required: unverified is reserved for legacy rows';
  END IF;

  IF NEW.origin NOT IN ('user_manual','unverified','review_queue') THEN
    IF NEW.evidence_quote IS NULL OR length(btrim(NEW.evidence_quote)) < 10 THEN
      RAISE EXCEPTION 'profile_entry_evidence_required: automated profile facts need a verbatim source quote';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;
