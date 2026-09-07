-- Deactivate the six-hourly PowerSync keepalive (job 14).
--
-- It opened a real authenticated sync stream for four seconds every run and
-- reported ok, and PowerSync still deprovisioned the Free-plan instance on
-- 2026-09-07 01:06 UTC, one hour after such a run. Short connections are not
-- activity to their counter; deploys are. The keepalive now runs on the hub VPS
-- as a scheduled deploy of the unchanged sync config (docs/CRON_JOBS.md, runbook
-- "PowerSync keepalive"). The function stays deployed; only the timer is off.
--
-- Applied to the live database the same day through the Management API.
-- Re-enable: select cron.alter_job(job_id := 14, active := true);
select cron.alter_job(job_id := 14, active := false)
where exists (select 1 from cron.job where jobid = 14 and jobname = 'powersync-keepalive');
