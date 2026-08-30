-- Rollback for 20260901090000_claims_cardinality_evidence_review.sql
--
-- Safe to run: these three columns are additive and nothing existing reads
-- them. Dropping them loses only the cardinality and review dates computed
-- since the migration ran, not any claim.
--
-- Run this BEFORE rolling back 20260901091000 (the world_claims widening),
-- because that view selects cardinality and review_by.

DROP INDEX IF EXISTS public.claims_review_by_idx;

ALTER TABLE public.claims
  DROP COLUMN IF EXISTS cardinality,
  DROP COLUMN IF EXISTS evidence_quote,
  DROP COLUMN IF EXISTS review_by;

DROP POLICY IF EXISTS "Anyone signed in may read the attribute rules" ON public.attribute_rules;
DROP TABLE IF EXISTS public.attribute_rules;
