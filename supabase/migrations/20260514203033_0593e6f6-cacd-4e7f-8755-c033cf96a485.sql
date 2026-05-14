UPDATE public.review_queue
SET status = 'dismissed'
WHERE suggestion_type = 'add_profile_entry'
  AND status IN ('pending','pending_review','auto_applied_unreviewed')
  AND source_note_id IN (SELECT id FROM public.notes WHERE source_app = 'querino');