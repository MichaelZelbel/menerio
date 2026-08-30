-- Rollback for 20260901092000_backfill_claim_rules.sql
--
-- Clears the two metadata columns the backfill populated, leaving every claim,
-- value and date untouched. In practice you would rarely run this on its own:
-- dropping the columns (20260901090000_..._rollback.sql) does the same and more.
UPDATE public.claims SET cardinality = 'one' WHERE cardinality <> 'one';
UPDATE public.claims SET review_by = NULL WHERE review_by IS NOT NULL;
