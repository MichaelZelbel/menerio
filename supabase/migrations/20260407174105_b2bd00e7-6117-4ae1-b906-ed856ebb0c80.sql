-- Step 1: Delete duplicate pending rows, keeping the oldest per group
DELETE FROM public.review_queue
WHERE status = 'pending'
  AND id NOT IN (
    SELECT DISTINCT ON (user_id, suggestion_type, title) id
    FROM public.review_queue
    WHERE status = 'pending'
    ORDER BY user_id, suggestion_type, title, created_at ASC
  );

-- Step 2: Add partial unique index to prevent future duplicates
CREATE UNIQUE INDEX uq_review_queue_pending
  ON public.review_queue (user_id, suggestion_type, title)
  WHERE status = 'pending';