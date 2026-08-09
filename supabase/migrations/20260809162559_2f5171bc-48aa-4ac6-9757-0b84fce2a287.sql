ALTER TABLE public.contact_relationships
  ADD COLUMN IF NOT EXISTS origin text NOT NULL DEFAULT 'user',
  ADD COLUMN IF NOT EXISTS evidence_quote text,
  ADD COLUMN IF NOT EXISTS evidence_note_id uuid REFERENCES public.notes(id) ON DELETE SET NULL;

CREATE OR REPLACE FUNCTION public.relationship_require_evidence()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF COALESCE(NEW.origin, 'user') <> 'user' THEN
    IF NEW.evidence_quote IS NULL OR length(btrim(NEW.evidence_quote)) < 10 THEN
      RAISE EXCEPTION 'relationship_evidence_required: automated relationships need a verbatim source quote';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_relationship_require_evidence ON public.contact_relationships;
CREATE TRIGGER trg_relationship_require_evidence
  BEFORE INSERT OR UPDATE ON public.contact_relationships
  FOR EACH ROW EXECUTE FUNCTION public.relationship_require_evidence();

UPDATE public.contacts SET entity_kind = 'real_person' WHERE entity_kind IS NULL;