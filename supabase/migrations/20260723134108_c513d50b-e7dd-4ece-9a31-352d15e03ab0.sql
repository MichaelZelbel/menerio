CREATE TABLE public.profile_normalization_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  contact_id uuid NULL,
  subject_type text NOT NULL DEFAULT 'contact' CHECK (subject_type IN ('owner', 'contact')),
  input_hash text NOT NULL,
  status text NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'completed', 'failed', 'skipped')),
  planned_count integer NOT NULL DEFAULT 0,
  applied_count integer NOT NULL DEFAULT 0,
  review_count integer NOT NULL DEFAULT 0,
  skipped_count integer NOT NULL DEFAULT 0,
  error_message text NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT profile_normalization_runs_subject_unique UNIQUE (user_id, subject_type, contact_id),
  CONSTRAINT profile_normalization_runs_contact_scope CHECK (
    (subject_type = 'owner' AND contact_id IS NULL) OR
    (subject_type = 'contact' AND contact_id IS NOT NULL)
  )
);

GRANT SELECT ON public.profile_normalization_runs TO authenticated;
GRANT ALL ON public.profile_normalization_runs TO service_role;

ALTER TABLE public.profile_normalization_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own normalization runs"
ON public.profile_normalization_runs
FOR SELECT
TO authenticated
USING (auth.uid() = user_id);

CREATE POLICY "Service role can manage normalization runs"
ON public.profile_normalization_runs
FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

CREATE TRIGGER handle_profile_normalization_runs_updated_at
BEFORE UPDATE ON public.profile_normalization_runs
FOR EACH ROW
EXECUTE FUNCTION public.handle_updated_at();