-- Rollback for 20260929090300_fact_store_cleanup.sql: nothing to restore.
-- The dropped helper and input tables were one-off; a validated constraint
-- needs no undo. For the whole go-live, use fact_store_rollback.sql.
SELECT 1;
