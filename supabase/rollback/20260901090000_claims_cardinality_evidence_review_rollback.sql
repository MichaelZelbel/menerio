-- Rollback for 20260901090000_claims_cardinality_evidence_review.sql
--
-- Safe to run: these three columns are additive and nothing existing reads
-- them. Dropping them loses only the cardinality and review dates computed
-- since the migration ran, not any claim.
--
-- ORDER. Run this LAST, after every other 2026-09-01 rollback, in descending
-- number: 097000, 096000, 095000, 094000, 093000, 092000, 091000, then this.
--
-- It must run AFTER 20260901091000_..._rollback.sql, not before. The widened
-- world_claims view selects claims.cardinality and claims.review_by, and
-- Postgres refuses to drop a column a view depends on, so the view has to be
-- narrowed first or the ALTER TABLE below fails.
--
-- (This header said "BEFORE" until 2026-08-31. It was backwards, and it
-- contradicted 091000's own header, which had the order right.)

DROP INDEX IF EXISTS public.claims_review_by_idx;

ALTER TABLE public.claims
  DROP COLUMN IF EXISTS cardinality,
  DROP COLUMN IF EXISTS evidence_quote,
  DROP COLUMN IF EXISTS review_by;

DROP POLICY IF EXISTS "Anyone signed in may read the attribute rules" ON public.attribute_rules;
DROP TABLE IF EXISTS public.attribute_rules;
