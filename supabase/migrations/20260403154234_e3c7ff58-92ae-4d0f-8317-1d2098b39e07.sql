CREATE TABLE public.review_queue (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL DEFAULT auth.uid(),
  source_note_id uuid REFERENCES public.notes(id) ON DELETE CASCADE,
  suggestion_type text NOT NULL,
  title text NOT NULL,
  description text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now(),
  reviewed_at timestamptz
);

ALTER TABLE public.review_queue ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own review queue items"
  ON public.review_queue
  FOR ALL
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE INDEX idx_review_queue_user_status ON public.review_queue (user_id, status);