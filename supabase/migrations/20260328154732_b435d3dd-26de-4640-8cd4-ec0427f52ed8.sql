
CREATE TABLE public.sync_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  note_id uuid REFERENCES public.notes(id) ON DELETE SET NULL,
  action text NOT NULL,
  details jsonb DEFAULT '{}'::jsonb,
  source_app text,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.sync_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own sync logs" ON public.sync_log
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

CREATE INDEX idx_sync_log_user_id ON public.sync_log (user_id);
CREATE INDEX idx_sync_log_note_id ON public.sync_log (note_id);
