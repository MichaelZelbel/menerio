-- pg_cron writes one row plus four updates to cron.job_run_details for every
-- run and never deletes any of them; Supabase's docs say so out loud. Menerio
-- runs about 2,200 scheduled jobs a day (drain-note-ai-jobs alone fires every
-- minute), so the log had reached 36,934 rows and 15 MB by 2026-09-11, and
-- net._http_response, pg_net's response log, held 552 live rows in 29 MB of
-- file that nothing ever hands back.
--
-- Querino showed where that ends: the same two tables were 1.3 GB there, 99
-- percent of the project's disk reads, and Supabase mailed a Disk IO warning
-- on 2026-09-11 (Querino migration 20260911130000, hub decision D-203). Menerio
-- was caught early. Applied live the same day: rows older than seven days
-- deleted (25,669), VACUUM FULL on both tables (306 MB -> 266 MB), and the
-- daily prune below. cron.schedule() replaces a job of the same name in place,
-- so this is safe to run again.

SELECT cron.schedule(
  'delete-job-run-details',
  '0 12 * * *',
  $$DELETE FROM cron.job_run_details WHERE end_time < now() - interval '7 days'$$
);
