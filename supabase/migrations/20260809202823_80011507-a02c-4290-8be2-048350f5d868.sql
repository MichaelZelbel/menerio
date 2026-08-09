ALTER TABLE public.contact_relationships ALTER COLUMN origin DROP DEFAULT;

ALTER TABLE public.contact_relationships DISABLE TRIGGER USER;
UPDATE public.contact_relationships
SET origin = 'unverified'
WHERE origin IS NULL
   OR origin <> 'user_manual'
   OR evidence_quote IS NULL;
ALTER TABLE public.contact_relationships ENABLE TRIGGER USER;

CREATE OR REPLACE FUNCTION public.relationship_require_evidence()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  allowed text[] := ARRAY['user_manual','unverified','ai_note','ai_moment','ai_lexicon','review_queue','import','mcp','api'];
BEGIN
  IF NEW.origin IS NULL OR NOT (NEW.origin = ANY(allowed)) THEN
    RAISE EXCEPTION 'relationship_origin_required: every relationship must declare a known origin (got %)', COALESCE(NEW.origin, 'NULL');
  END IF;

  IF TG_OP = 'INSERT' AND NEW.origin = 'unverified' THEN
    RAISE EXCEPTION 'relationship_origin_required: unverified is reserved for legacy rows';
  END IF;

  IF NEW.origin NOT IN ('user_manual','unverified') THEN
    IF NEW.evidence_quote IS NULL OR length(btrim(NEW.evidence_quote)) < 10 THEN
      RAISE EXCEPTION 'relationship_evidence_required: automated relationships need a verbatim source quote';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

ALTER TABLE public.profile_entries
  ADD COLUMN IF NOT EXISTS origin text NOT NULL DEFAULT 'unverified',
  ADD COLUMN IF NOT EXISTS evidence_quote text;

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
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_profile_entry_require_origin ON public.profile_entries;
CREATE TRIGGER trg_profile_entry_require_origin
BEFORE INSERT OR UPDATE ON public.profile_entries
FOR EACH ROW EXECUTE FUNCTION public.profile_entry_require_origin();