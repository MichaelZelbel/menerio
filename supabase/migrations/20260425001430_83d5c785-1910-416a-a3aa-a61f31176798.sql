CREATE TABLE IF NOT EXISTS public.moments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  moment_uid uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  title text NOT NULL,
  description text,
  happened_at timestamptz NOT NULL,
  happened_end timestamptz,
  status text NOT NULL DEFAULT 'unknown',
  impact_level integer NOT NULL DEFAULT 2,
  confidence_date integer NOT NULL DEFAULT 5,
  confidence_truth integer NOT NULL DEFAULT 5,
  category text,
  attachments jsonb,
  person_id uuid,
  source text NOT NULL DEFAULT 'manual',
  verified boolean NOT NULL DEFAULT false,
  is_potential_major boolean NOT NULL DEFAULT false,
  merge_auto boolean NOT NULL DEFAULT false,
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT moments_status_check CHECK (status IN ('past_fact', 'future_plan', 'ongoing', 'unknown')),
  CONSTRAINT moments_impact_level_check CHECK (impact_level BETWEEN 1 AND 4),
  CONSTRAINT moments_confidence_date_check CHECK (confidence_date BETWEEN 0 AND 10),
  CONSTRAINT moments_confidence_truth_check CHECK (confidence_truth BETWEEN 0 AND 10)
);

CREATE TABLE IF NOT EXISTS public.moment_participants (
  moment_id uuid NOT NULL REFERENCES public.moments(id) ON DELETE CASCADE,
  person_id uuid NOT NULL,
  PRIMARY KEY (moment_id, person_id)
);

CREATE TABLE IF NOT EXISTS public.moment_provenance (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  moment_id uuid NOT NULL REFERENCES public.moments(id) ON DELETE CASCADE,
  document_id uuid NOT NULL,
  page_number integer,
  snippet_original text,
  snippet_en text,
  language text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_moments_user_happened_at ON public.moments (user_id, happened_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_moments_user_person ON public.moments (user_id, person_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_moment_participants_person ON public.moment_participants (person_id, moment_id);
CREATE INDEX IF NOT EXISTS idx_moment_provenance_user_moment ON public.moment_provenance (user_id, moment_id);
CREATE INDEX IF NOT EXISTS idx_moment_provenance_document ON public.moment_provenance (document_id);

ALTER TABLE public.moments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.moment_participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.moment_provenance ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own moments"
ON public.moments
FOR SELECT
TO authenticated
USING (auth.uid() = user_id);

CREATE POLICY "Users can create their own moments"
ON public.moments
FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own moments"
ON public.moments
FOR UPDATE
TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete their own moments"
ON public.moments
FOR DELETE
TO authenticated
USING (auth.uid() = user_id);

CREATE POLICY "Users can view participants for their moments"
ON public.moment_participants
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.moments
    WHERE moments.id = moment_participants.moment_id
      AND moments.user_id = auth.uid()
  )
);

CREATE POLICY "Users can create participants for their moments"
ON public.moment_participants
FOR INSERT
TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.moments
    WHERE moments.id = moment_participants.moment_id
      AND moments.user_id = auth.uid()
  )
);

CREATE POLICY "Users can update participants for their moments"
ON public.moment_participants
FOR UPDATE
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.moments
    WHERE moments.id = moment_participants.moment_id
      AND moments.user_id = auth.uid()
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.moments
    WHERE moments.id = moment_participants.moment_id
      AND moments.user_id = auth.uid()
  )
);

CREATE POLICY "Users can delete participants for their moments"
ON public.moment_participants
FOR DELETE
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.moments
    WHERE moments.id = moment_participants.moment_id
      AND moments.user_id = auth.uid()
  )
);

CREATE POLICY "Users can view their own moment provenance"
ON public.moment_provenance
FOR SELECT
TO authenticated
USING (auth.uid() = user_id);

CREATE POLICY "Users can create their own moment provenance"
ON public.moment_provenance
FOR INSERT
TO authenticated
WITH CHECK (
  auth.uid() = user_id
  AND EXISTS (
    SELECT 1 FROM public.moments
    WHERE moments.id = moment_provenance.moment_id
      AND moments.user_id = auth.uid()
  )
);

CREATE POLICY "Users can delete their own moment provenance"
ON public.moment_provenance
FOR DELETE
TO authenticated
USING (auth.uid() = user_id);

CREATE TRIGGER update_moments_updated_at
BEFORE UPDATE ON public.moments
FOR EACH ROW
EXECUTE FUNCTION public.handle_updated_at();