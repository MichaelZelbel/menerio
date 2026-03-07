
CREATE TABLE public.activity_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  action text NOT NULL,
  item_type text NOT NULL,
  item_id uuid,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_activity_events_actor ON public.activity_events(actor_id, created_at DESC);
CREATE INDEX idx_activity_events_created ON public.activity_events(created_at DESC);

ALTER TABLE public.activity_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own events"
  ON public.activity_events FOR SELECT
  TO authenticated
  USING (actor_id = auth.uid() OR public.is_admin(auth.uid()));

CREATE POLICY "Users can insert own events"
  ON public.activity_events FOR INSERT
  TO authenticated
  WITH CHECK (actor_id = auth.uid());
