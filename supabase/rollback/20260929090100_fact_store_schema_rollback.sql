-- Rollback for 20260929090100_fact_store_schema.sql.
--
-- Run supabase/rollback/fact_store_rollback.sql. It undoes this migration alone
-- when the switch has not run, and the switch first when it has, in the order
-- the two need (docs/plans/one-fact-store.md, 5.4). Keeping one script means
-- the two halves can never be run in the wrong order.
DO $$ BEGIN RAISE EXCEPTION 'run supabase/rollback/fact_store_rollback.sql instead'; END $$;
