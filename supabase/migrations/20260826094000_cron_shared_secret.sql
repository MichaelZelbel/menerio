-- Shared scheduler secret: pg_cron -> edge-function calls authenticate with an
-- x-cron-key header whose value lives ONLY in this database.
--
-- Before this migration, the sweeps for profile-reconcile, profile-audit,
-- wiki-restructure, powersync-keepalive and admin-normalize were triggered
-- with the public anon key plus a plaintext body marker such as
-- {"cron": "profile-reconcile"} — replayable by anyone who knows the URL.
-- Now every scheduled job goes through internal.call_edge(), which attaches
-- the secret per run, and the functions verify it via the service-role-only
-- RPC get_cron_secret() (supabase/functions/_shared/cron-auth.ts).
--
-- Rotation (no redeploys needed, jobs and functions read the row at runtime):
--   UPDATE internal.cron_secret
--   SET value = encode(extensions.gen_random_bytes(32), 'hex') WHERE id = 1;
-- Inventory and runbook: docs/CRON_JOBS.md.

create schema if not exists internal;
revoke all on schema internal from public;

create table if not exists internal.cron_secret (
  id int primary key default 1 check (id = 1),
  value text not null
);
revoke all on table internal.cron_secret from public;

-- Generated inside the database on purpose: the value never appears in this
-- repo, in a chat log, or in an environment variable.
insert into internal.cron_secret (id, value)
values (1, encode(extensions.gen_random_bytes(32), 'hex'))
on conflict (id) do nothing;

-- Edge functions read the expected key through this; only service_role may call it.
create or replace function public.get_cron_secret()
returns text
language sql
security definer
set search_path = ''
as $$
  select value from internal.cron_secret where id = 1
$$;

revoke execute on function public.get_cron_secret() from public, anon, authenticated;
grant execute on function public.get_cron_secret() to service_role;

-- The one way a scheduled job calls an edge function. The Authorization
-- header carries the public anon key so the call also passes a verify_jwt
-- gateway; the x-cron-key header is what actually authenticates. Returns the
-- pg_net request id so a manual run can be checked in net._http_response.
create or replace function internal.call_edge(fn_name text, payload jsonb)
returns bigint
language sql
security definer
set search_path = ''
as $$
  select net.http_post(
    url := 'https://tjeapelvjlmbxafsmjef.supabase.co/functions/v1/' || fn_name,
    headers := pg_catalog.jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRqZWFwZWx2amxtYnhhZnNtamVmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI5MTk3MDUsImV4cCI6MjA4ODQ5NTcwNX0.xzux7CmiNNDdtcjaPvuJRqs8_ZtiljbDjim4Mdm4siU',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRqZWFwZWx2amxtYnhhZnNtamVmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI5MTk3MDUsImV4cCI6MjA4ODQ5NTcwNX0.xzux7CmiNNDdtcjaPvuJRqs8_ZtiljbDjim4Mdm4siU',
      'x-cron-key', (select value from internal.cron_secret where id = 1)
    ),
    body := payload,
    timeout_milliseconds := 10000
  )
$$;

revoke execute on function internal.call_edge(text, jsonb) from public;
-- No further grants: pg_cron runs every job below as postgres, which owns internal.*.

-- Rewrite the five affected jobs in place (schedules untouched). Matched by
-- the URL in their current command, pinned against the 2026-08-26 inventory:
--   jobid  4  menerio-profile-normalize-jobs-6h  -> admin-normalize
--   jobid  6  wiki-restructure-sweep             -> wiki-restructure
--   jobid 12  profile-reconcile-sweep            -> profile-reconcile
--   jobid 13  profile-audit-sweep                -> profile-audit
--   jobid 14  powersync-keepalive                -> powersync-keepalive
-- Jobs already sending x-cron-key (gdrive-*, profile-lint, explode-bags) are
-- explicitly skipped. Bodies keep their previous fields, including the
-- {"cron": ...} markers, which are routing only and grant nothing anymore.
do $mig$
declare
  job record;
  rewritten int := 0;
  migrated int;
begin
  for job in
    select jobid, jobname, command from cron.job
    where command not ilike '%internal.call_edge%'
      and command not ilike '%x-cron-key%'
      and (command ilike '%/functions/v1/profile-reconcile%'
        or command ilike '%/functions/v1/profile-audit%'
        or command ilike '%/functions/v1/wiki-restructure%'
        or command ilike '%/functions/v1/powersync-keepalive%'
        or command ilike '%/functions/v1/admin-normalize%')
  loop
    if job.command ilike '%/functions/v1/profile-reconcile%' then
      perform cron.alter_job(job_id := job.jobid, command :=
        $cmd$select internal.call_edge('profile-reconcile', jsonb_build_object('cron', 'profile-reconcile', 'scope', 'all'))$cmd$);
    elsif job.command ilike '%/functions/v1/profile-audit%' then
      perform cron.alter_job(job_id := job.jobid, command :=
        $cmd$select internal.call_edge('profile-audit', jsonb_build_object('cron', 'profile-audit', 'limit', 25))$cmd$);
    elsif job.command ilike '%/functions/v1/wiki-restructure%' then
      perform cron.alter_job(job_id := job.jobid, command :=
        $cmd$select internal.call_edge('wiki-restructure', jsonb_build_object('cron', 'wiki-restructure', 'limit', 10))$cmd$);
    elsif job.command ilike '%/functions/v1/powersync-keepalive%' then
      perform cron.alter_job(job_id := job.jobid, command :=
        $cmd$select internal.call_edge('powersync-keepalive', jsonb_build_object('time', now()::text))$cmd$);
    elsif job.command ilike '%/functions/v1/admin-normalize%' then
      perform cron.alter_job(job_id := job.jobid, command :=
        $cmd$select internal.call_edge('admin-normalize', jsonb_build_object('cron', 'profile-normalization', 'includeNotesContext', true))$cmd$);
    end if;
    rewritten := rewritten + 1;
    raise notice 'cron_shared_secret: rewrote job % (%)', job.jobid, job.jobname;
  end loop;

  -- Idempotent assertion: after this migration exactly five scheduler jobs
  -- must go through call_edge, whether this run rewrote them or an earlier
  -- run already did. Anything else means the live cron.job table drifted from
  -- the inventory above, and silently continuing would strand a sweep on the
  -- old header-less call once the functions start requiring the key.
  select count(*) into migrated from cron.job where command ilike '%internal.call_edge%';
  if migrated <> 5 then
    raise exception
      'cron_shared_secret: % job(s) call internal.call_edge, expected 5 (rewrote % this run). Inspect cron.job and update this migration before deploying the strict functions.',
      migrated, rewritten;
  end if;
end
$mig$;

-- PostgREST must pick up get_cron_secret before an edge cold-start asks for it.
notify pgrst, 'reload schema';
