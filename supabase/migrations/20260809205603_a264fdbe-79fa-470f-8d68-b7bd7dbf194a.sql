CREATE TABLE public.profile_reconcile_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'running',
  stats jsonb NOT NULL DEFAULT '{}'::jsonb,
  error text,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.profile_reconcile_runs TO authenticated;
GRANT ALL ON public.profile_reconcile_runs TO service_role;

ALTER TABLE public.profile_reconcile_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own reconcile runs"
ON public.profile_reconcile_runs FOR SELECT TO authenticated
USING (auth.uid() = user_id);

CREATE INDEX idx_profile_reconcile_runs_user ON public.profile_reconcile_runs (user_id, started_at DESC);

CREATE TRIGGER trg_profile_reconcile_runs_updated_at
BEFORE UPDATE ON public.profile_reconcile_runs
FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

SELECT cron.schedule(
  'profile-reconcile-sweep',
  '17 */2 * * *',
  $$
  SELECT net.http_post(
    url := 'https://tjeapelvjlmbxafsmjef.supabase.co/functions/v1/profile-reconcile',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRqZWFwZWx2amxtYnhhZnNtamVmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI5MTk3MDUsImV4cCI6MjA4ODQ5NTcwNX0.xzux7CmiNNDdtcjaPvuJRqs8_ZtiljbDjim4Mdm4siU'
    ),
    body := jsonb_build_object('cron', 'profile-reconcile', 'scope', 'all')
  );
  $$
);