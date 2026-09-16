-- Found while proving 20260916120000 on production, inside a transaction that
-- was rolled back on purpose: deleting an auth user now cascades through
-- profile_entries and contact_group_memberships, and three AFTER DELETE
-- triggers on those rows write on behalf of the owner who is being deleted.
--
--   profile_entries -> enqueue_profile_normalization_job()  inserts a job row
--   profile_entries -> profile_audit_mark_dirty()           inserts an audit row
--   contact_group_memberships -> sync_group_wiki_members()  raises 'group not found'
--
-- With the new foreign keys the first two inserts are refused (the user is
-- gone), and the third raised on its own already, so the whole deletion rolled
-- back. Before the keys existed the same triggers quietly left a queued job
-- and a dirty audit row for a user who no longer existed.
--
-- Each writer now checks that the subject still exists and returns when it
-- does not. Nothing changes for an ordinary edit by a live account.

create or replace function public.enqueue_profile_normalization_job(p_user_id uuid, p_contact_id uuid, p_reason text default null::text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_subject_type text := case when p_contact_id is null then 'owner' else 'contact' end;
begin
  if p_user_id is null then
    return;
  end if;
  -- The owner is being deleted (a cascade from auth.users): nothing to plan.
  if not exists (select 1 from auth.users u where u.id = p_user_id) then
    return;
  end if;

  insert into public.profile_normalization_jobs (
    user_id, contact_id, subject_type, status, attempts, reason, last_error, requested_at, claimed_at, processed_at
  ) values (
    p_user_id, p_contact_id, v_subject_type, 'queued', 0, p_reason, null, now(), null, null
  )
  on conflict (user_id, subject_type, coalesce(contact_id, '00000000-0000-0000-0000-000000000000'::uuid))
  do update set
    status = 'queued',
    reason = coalesce(excluded.reason, public.profile_normalization_jobs.reason),
    last_error = null,
    requested_at = now(),
    claimed_at = null,
    processed_at = null,
    updated_at = now();
end;
$function$;

create or replace function public.profile_audit_mark_dirty(_user_id uuid, _contact_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  -- The owner is being deleted (a cascade from auth.users): nothing to audit.
  if _user_id is null or not exists (select 1 from auth.users u where u.id = _user_id) then
    return;
  end if;
  insert into public.profile_audit_runs (user_id, contact_id, status, dirty_at, updated_at)
  values (_user_id, _contact_id, 'dirty', now(), now())
  on conflict (user_id, contact_key) do update
    set status = 'dirty',
        dirty_at = now(),
        updated_at = now();
end;
$function$;

create or replace function public.handle_group_membership_wiki_sync()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_group_id uuid;
begin
  v_group_id := coalesce(new.group_id, old.group_id);

  -- A membership deleted because its group (or its owner) is going has no
  -- page left to refresh; sync_group_wiki_members() raises for a missing group.
  if v_group_id is not null and exists (select 1 from public.contact_groups g where g.id = v_group_id) then
    perform public.sync_group_wiki_members(v_group_id, false);
  end if;

  return coalesce(new, old);
end;
$function$;
