-- profile-audit-sweep: every 15 minutes becomes every 6 hours.
--
-- The audit is event driven. Any write to profile_entries marks that scope
-- dirty (trg_profile_entries_mark_audit_dirty), and this cron only DRAINS the
-- dirty queue. So the schedule does not decide whether a duplicate is found, it
-- only decides how long a duplicate waits, and how fast a bug can spend.
--
-- Nothing in the repo ever justified */15. It was 96 runs a day, and on
-- 2026-08-30 that turned one false-progress bug into 24 LLM calls an hour for 52
-- hours (see 20260903100000). Tidying duplicate facts is not time critical;
-- a quarter of a day is not a wait anyone notices.
--
-- Minute 50 is deliberate: it avoids the existing 22 */6 (profile-normalize,
-- wiki-restructure), 17 */6 (powersync-keepalive) and 17 */2 (profile-reconcile)
-- jobs, so the six-hourly jobs do not all fire into the same edge runtime.
--
-- The command is copied verbatim from 20260826094000_cron_shared_secret.sql. It
-- MUST stay on internal.call_edge, which attaches the x-cron-key the function
-- authenticates; that migration's guard fails the deploy if any job drifts off
-- call_edge.

SELECT cron.unschedule('profile-audit-sweep')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'profile-audit-sweep');

SELECT cron.schedule(
  'profile-audit-sweep',
  '50 */6 * * *',
  $cmd$select internal.call_edge('profile-audit', jsonb_build_object('cron', 'profile-audit', 'limit', 25))$cmd$
);

DO $$
DECLARE
  v_schedule text;
BEGIN
  SELECT schedule INTO v_schedule FROM cron.job WHERE jobname = 'profile-audit-sweep';
  IF v_schedule IS DISTINCT FROM '50 */6 * * *' THEN
    RAISE EXCEPTION
      'profile-audit-sweep did not take the new schedule (got %). Inspect cron.job.', v_schedule;
  END IF;
END $$;
