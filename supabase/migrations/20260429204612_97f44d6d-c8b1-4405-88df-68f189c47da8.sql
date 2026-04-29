CREATE TABLE IF NOT EXISTS public.generation_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  description text NOT NULL,
  response jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.generation_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view their own generation logs" ON public.generation_logs;
CREATE POLICY "Users can view their own generation logs"
ON public.generation_logs
FOR SELECT
TO authenticated
USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can create their own generation logs" ON public.generation_logs;
CREATE POLICY "Users can create their own generation logs"
ON public.generation_logs
FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_generation_logs_user_created_at
ON public.generation_logs (user_id, created_at DESC);