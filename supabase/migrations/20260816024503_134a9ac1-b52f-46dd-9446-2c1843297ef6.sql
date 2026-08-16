
REVOKE EXECUTE ON FUNCTION public.profile_audit_mark_dirty(uuid, uuid) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.profile_audit_apply_merge(uuid, uuid, uuid[], text, text, text) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.profile_audit_rollback_merge(uuid) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.profile_entries_mark_audit_dirty() FROM anon, authenticated;

SELECT cron.unschedule('profile-audit-sweep')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'profile-audit-sweep');

SELECT cron.schedule(
  'profile-audit-sweep',
  '*/15 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://tjeapelvjlmbxafsmjef.supabase.co/functions/v1/profile-audit',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRqZWFwZWx2amxtYnhhZnNtamVmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI5MTk3MDUsImV4cCI6MjA4ODQ5NTcwNX0.xzux7CmiNNDdtcjaPvuJRqs8_ZtiljbDjim4Mdm4siU'
    ),
    body := jsonb_build_object('cron', 'profile-audit', 'limit', 25)
  );
  $$
);
