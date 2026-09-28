-- Rollback for 20260929090050_fact_writer_pause.sql. The functions that call
-- fact_writes_paused() treat a missing function as "not paused".
DROP FUNCTION IF EXISTS public.fact_writes_paused();
DROP TABLE IF EXISTS public.maintenance_flags;
