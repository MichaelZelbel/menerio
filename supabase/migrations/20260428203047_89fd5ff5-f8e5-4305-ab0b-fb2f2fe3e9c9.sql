ALTER TABLE public.review_queue
ADD COLUMN IF NOT EXISTS snoozed_until TIMESTAMP WITH TIME ZONE;

CREATE INDEX IF NOT EXISTS idx_review_queue_snoozed_until
ON public.review_queue (user_id, status, snoozed_until);