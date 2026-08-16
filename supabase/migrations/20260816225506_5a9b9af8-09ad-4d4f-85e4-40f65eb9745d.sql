DO $$
DECLARE
  n integer;
BEGIN
  SELECT count(*) INTO n
    FROM public.review_queue
   WHERE suggestion_type IN ('add_entity', 'add_claim')
     AND status IN ('pending', 'pending_review', 'auto_applied_unreviewed');
  RAISE NOTICE 'world extractor cleanup: closing % review_queue rows', n;
END $$;

UPDATE public.review_queue
   SET status      = 'removed',
       reviewed_at = now()
 WHERE suggestion_type IN ('add_entity', 'add_claim')
   AND status IN ('pending', 'pending_review', 'auto_applied_unreviewed');