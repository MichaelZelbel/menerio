-- Normalize obvious profile-entry text for duplicate detection.
CREATE OR REPLACE FUNCTION public.profile_entry_norm_text(p_value text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT lower(regexp_replace(btrim(coalesce(p_value, '')), '\s+', ' ', 'g'))
$$;

-- Queue table for server-side background profile normalization work.
CREATE TABLE IF NOT EXISTS public.profile_normalization_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  contact_id uuid NULL,
  subject_type text NOT NULL DEFAULT 'owner' CHECK (subject_type IN ('owner', 'contact')),
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'completed', 'failed')),
  attempts integer NOT NULL DEFAULT 0,
  reason text NULL,
  last_error text NULL,
  requested_at timestamptz NOT NULL DEFAULT now(),
  claimed_at timestamptz NULL,
  processed_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((subject_type = 'owner' AND contact_id IS NULL) OR (subject_type = 'contact' AND contact_id IS NOT NULL))
);

GRANT ALL ON public.profile_normalization_jobs TO service_role;

ALTER TABLE public.profile_normalization_jobs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role can manage profile normalization jobs" ON public.profile_normalization_jobs;
CREATE POLICY "Service role can manage profile normalization jobs"
ON public.profile_normalization_jobs
FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

CREATE UNIQUE INDEX IF NOT EXISTS profile_normalization_jobs_subject_unique
ON public.profile_normalization_jobs (
  user_id,
  subject_type,
  COALESCE(contact_id, '00000000-0000-0000-0000-000000000000'::uuid)
);

DROP TRIGGER IF EXISTS update_profile_normalization_jobs_updated_at ON public.profile_normalization_jobs;
CREATE TRIGGER update_profile_normalization_jobs_updated_at
BEFORE UPDATE ON public.profile_normalization_jobs
FOR EACH ROW
EXECUTE FUNCTION public.handle_updated_at();

CREATE OR REPLACE FUNCTION public.enqueue_profile_normalization_job(
  p_user_id uuid,
  p_contact_id uuid,
  p_reason text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_subject_type text := CASE WHEN p_contact_id IS NULL THEN 'owner' ELSE 'contact' END;
BEGIN
  IF p_user_id IS NULL THEN
    RETURN;
  END IF;

  INSERT INTO public.profile_normalization_jobs (
    user_id,
    contact_id,
    subject_type,
    status,
    attempts,
    reason,
    last_error,
    requested_at,
    claimed_at,
    processed_at
  ) VALUES (
    p_user_id,
    p_contact_id,
    v_subject_type,
    'queued',
    0,
    p_reason,
    NULL,
    now(),
    NULL,
    NULL
  )
  ON CONFLICT (user_id, subject_type, COALESCE(contact_id, '00000000-0000-0000-0000-000000000000'::uuid))
  DO UPDATE SET
    status = 'queued',
    reason = COALESCE(EXCLUDED.reason, public.profile_normalization_jobs.reason),
    last_error = NULL,
    requested_at = now(),
    claimed_at = NULL,
    processed_at = NULL,
    updated_at = now();
END;
$$;

CREATE OR REPLACE FUNCTION public.handle_profile_entries_enqueue_normalization()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := COALESCE(NEW.user_id, OLD.user_id);
  v_contact_id uuid := COALESCE(NEW.contact_id, OLD.contact_id);
BEGIN
  PERFORM public.enqueue_profile_normalization_job(v_user_id, v_contact_id, TG_OP);
  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS profile_entries_enqueue_normalization ON public.profile_entries;
CREATE TRIGGER profile_entries_enqueue_normalization
AFTER INSERT OR UPDATE OR DELETE ON public.profile_entries
FOR EACH ROW
EXECUTE FUNCTION public.handle_profile_entries_enqueue_normalization();

-- One-time cleanup: collapse exact duplicate rows before adding the unique guard.
WITH ranked AS (
  SELECT
    e.id,
    row_number() OVER (
      PARTITION BY
        e.user_id,
        COALESCE(e.contact_id, '00000000-0000-0000-0000-000000000000'::uuid),
        e.category_id,
        public.profile_entry_norm_text(e.label),
        public.profile_entry_norm_text(e.value)
      ORDER BY
        e.is_pinned DESC,
        e.updated_at DESC NULLS LAST,
        e.created_at ASC NULLS LAST,
        e.id ASC
    ) AS rn
  FROM public.profile_entries e
)
DELETE FROM public.profile_entries e
USING ranked r
WHERE e.id = r.id
  AND r.rn > 1;

CREATE UNIQUE INDEX IF NOT EXISTS profile_entries_no_exact_duplicate
ON public.profile_entries (
  user_id,
  COALESCE(contact_id, '00000000-0000-0000-0000-000000000000'::uuid),
  category_id,
  public.profile_entry_norm_text(label),
  public.profile_entry_norm_text(value)
);