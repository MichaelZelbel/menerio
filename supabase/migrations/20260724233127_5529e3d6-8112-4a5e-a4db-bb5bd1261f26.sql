
CREATE TABLE public.review_queue_bulk_jobs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  action TEXT NOT NULL CHECK (action IN ('keep','rollback','never_again')),
  scope TEXT NOT NULL DEFAULT 'all',
  total INTEGER NOT NULL DEFAULT 0,
  done INTEGER NOT NULL DEFAULT 0,
  failed INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running','done','error')),
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX review_queue_bulk_jobs_user_created_idx
  ON public.review_queue_bulk_jobs(user_id, created_at DESC);

GRANT SELECT ON public.review_queue_bulk_jobs TO authenticated;
GRANT ALL ON public.review_queue_bulk_jobs TO service_role;

ALTER TABLE public.review_queue_bulk_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owners can view their own bulk jobs"
  ON public.review_queue_bulk_jobs
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE TRIGGER trg_review_queue_bulk_jobs_updated_at
  BEFORE UPDATE ON public.review_queue_bulk_jobs
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
