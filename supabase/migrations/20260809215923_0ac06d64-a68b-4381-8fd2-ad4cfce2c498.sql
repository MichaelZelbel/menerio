CREATE TABLE IF NOT EXISTS public.relationship_rejections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  pair_key text NOT NULL,
  reason text,
  rejected_label text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_relationship_rejections_pair
  ON public.relationship_rejections (user_id, pair_key);

GRANT SELECT, INSERT, DELETE ON public.relationship_rejections TO authenticated;
GRANT ALL ON public.relationship_rejections TO service_role;

ALTER TABLE public.relationship_rejections ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users manage own relationship rejections" ON public.relationship_rejections;
CREATE POLICY "Users manage own relationship rejections"
  ON public.relationship_rejections FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE OR REPLACE FUNCTION public.relationship_rejection_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE k text;
BEGIN
  k := public.relationship_pair_key(NEW.user_id, NEW.source_type, NEW.source_id, NEW.target_type, NEW.target_id, coalesce(NEW.custom_label, NEW.label));

  IF NEW.origin = 'user_manual' THEN
    DELETE FROM public.relationship_rejections r WHERE r.user_id = NEW.user_id AND r.pair_key = k;
    RETURN NEW;
  END IF;

  IF EXISTS (SELECT 1 FROM public.relationship_rejections r WHERE r.user_id = NEW.user_id AND r.pair_key = k) THEN
    RETURN NULL;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_relationship_rejection_guard ON public.contact_relationships;
CREATE TRIGGER trg_relationship_rejection_guard
  BEFORE INSERT OR UPDATE ON public.contact_relationships
  FOR EACH ROW EXECUTE FUNCTION public.relationship_rejection_guard();