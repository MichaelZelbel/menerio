-- One switch that pauses every fact writer (docs/plans/one-fact-store.md, B1;
-- A1 run, finding 3). About nine server paths start the note pipeline directly,
-- several from webhooks, so they cannot be paused one by one. Each fact writer
-- asks fact_writes_paused() first; while it answers true, process-note leaves
-- the note in note_ai_jobs for later and the others refuse with a retryable error.
--
-- Applied before B1 (with the functions that read it). Additive: until the
-- flag is set, nothing changes.

CREATE TABLE IF NOT EXISTS public.maintenance_flags (
  key        text PRIMARY KEY,
  is_on      boolean NOT NULL DEFAULT false,
  changed_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.maintenance_flags ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.maintenance_flags FROM anon, authenticated;

INSERT INTO public.maintenance_flags (key, is_on) VALUES ('fact_writes_paused', false)
ON CONFLICT (key) DO NOTHING;

CREATE OR REPLACE FUNCTION public.fact_writes_paused() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT coalesce((SELECT is_on FROM public.maintenance_flags WHERE key = 'fact_writes_paused'), false)
$$;
REVOKE ALL ON FUNCTION public.fact_writes_paused() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.fact_writes_paused() TO authenticated, service_role;
