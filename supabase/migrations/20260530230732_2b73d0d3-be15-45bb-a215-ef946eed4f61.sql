-- Re-pend the three already-"kept" profile entry suggestions that were never actually inserted
-- (target_entity_id IS NULL means the prior buggy Keep flow just flipped the status).
-- Also rewrite the Birthday suggestion to the canonical Date of birth form.
UPDATE public.review_queue
SET status = 'pending_review',
    reviewed_at = NULL,
    payload = jsonb_set(
      jsonb_set(payload, '{label}', '"Date of birth"'::jsonb, true),
      '{value}', '"1965-05-25"'::jsonb, true
    ),
    title = 'Add to Gunther Reinhard''s profile: Date of birth',
    extracted_value = 'Date of birth: 1965-05-25'
WHERE id = '0b926cb9-b061-4d5d-aabc-d6394d515a06';

UPDATE public.review_queue
SET status = 'pending_review', reviewed_at = NULL
WHERE id IN (
  '26512f81-09f3-43bb-bce1-844a96ba7bae',
  '0d3098ad-b239-48c5-8013-a9e3fad94d83'
);