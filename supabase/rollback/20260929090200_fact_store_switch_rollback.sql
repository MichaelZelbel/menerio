-- Rollback for 20260929090200_fact_store_switch.sql.
--
-- Run supabase/rollback/fact_store_rollback.sql. It restores the data from the
-- B1 snapshot (fact_backup) and then undoes the schema migration too, in the
-- order the two need (docs/plans/one-fact-store.md, 5.4). Keeping one script
-- means the two halves can never be run in the wrong order.
DO $$ BEGIN RAISE EXCEPTION 'run supabase/rollback/fact_store_rollback.sql instead'; END $$;
