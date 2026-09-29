-- The review queue becomes a list of references. New code writes no snapshot;
-- old code that still writes one keeps working until it is redeployed.
-- 20261001100300 wipes the old copies and forbids new ones.
ALTER TABLE public.moderation_review_queue ALTER COLUMN content_snapshot DROP NOT NULL;
