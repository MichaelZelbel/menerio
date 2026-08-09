CREATE OR REPLACE FUNCTION public.profile_entry_require_origin()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  allowed text[] := ARRAY['user_manual','unverified','ai_note','ai_moment','ai_lexicon','review_queue','import','mcp','api','normalizer'];
BEGIN
  IF NEW.origin IS NULL OR NOT (NEW.origin = ANY(allowed)) THEN
    RAISE EXCEPTION 'profile_entry_origin_required: unknown origin %', COALESCE(NEW.origin, 'NULL');
  END IF;

  IF TG_OP = 'INSERT' AND NEW.origin = 'unverified' THEN
    RAISE EXCEPTION 'profile_entry_origin_required: unverified is reserved for legacy rows';
  END IF;

  IF NEW.origin NOT IN ('user_manual','unverified','review_queue') THEN
    IF NEW.evidence_quote IS NULL OR length(btrim(NEW.evidence_quote)) < 10 THEN
      RAISE EXCEPTION 'profile_entry_evidence_required: automated profile facts need a verbatim source quote';
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;