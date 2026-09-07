-- Paid normalization evaluations are separate from the existing maintenance queue.
-- Results contain sensitive profile plans: no client table access or public RPCs.
create table if not exists public.profile_normalization_leases (
  user_id uuid not null references auth.users(id) on delete cascade,
  subject_key text not null,
  lease_id uuid,
  lease_expires_at timestamptz,
  fingerprint text,
  primary key (user_id, subject_key)
);
create table if not exists public.profile_normalization_inputs (
  user_id uuid not null references auth.users(id) on delete cascade,
  subject_key text not null,
  fingerprint text not null check (fingerprint ~ '^[a-f0-9]{64}$'),
  result jsonb,
  attempts integer not null default 0,
  evaluated_at timestamptz,
  completed_at timestamptz,
  primary key (user_id, subject_key, fingerprint)
);
alter table public.profile_normalization_leases enable row level security;
alter table public.profile_normalization_inputs enable row level security;
revoke all on public.profile_normalization_leases, public.profile_normalization_inputs from public, anon, authenticated;

create or replace function public.claim_profile_normalization_input(
  p_user_id uuid, p_contact_id uuid, p_fingerprint text, p_manual boolean default false
) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  subject text := coalesce(p_contact_id::text, 'owner');
  held public.profile_normalization_leases%rowtype;
  saved public.profile_normalization_inputs%rowtype;
  token uuid := gen_random_uuid();
begin
  if p_fingerprint is null or p_fingerprint !~ '^[a-f0-9]{64}$' then raise exception 'Invalid normalization fingerprint'; end if;
  if p_contact_id is not null and not exists(select 1 from public.contacts where id = p_contact_id and user_id = p_user_id) then
    raise exception 'Subject does not belong to account';
  end if;
  insert into public.profile_normalization_leases(user_id, subject_key) values(p_user_id, subject) on conflict do nothing;
  select * into held from public.profile_normalization_leases where user_id = p_user_id and subject_key = subject for update;
  if held.lease_id is not null and held.lease_expires_at > clock_timestamp() then return null; end if;
  -- Keep the newest 64 completed evaluations plus current/uncertain work.
  -- Uncertain attempts are diagnostic records and must not reset via eviction.
  delete from public.profile_normalization_inputs where user_id = p_user_id and subject_key = subject
    and fingerprint in (select fingerprint from public.profile_normalization_inputs
      where user_id = p_user_id and subject_key = subject and fingerprint <> p_fingerprint and completed_at is not null
      order by completed_at desc, fingerprint offset 64);
  insert into public.profile_normalization_inputs(user_id, subject_key, fingerprint) values(p_user_id, subject, p_fingerprint) on conflict do nothing;
  select * into saved from public.profile_normalization_inputs where user_id = p_user_id and subject_key = subject and fingerprint = p_fingerprint;
  if saved.result is null and saved.attempts >= 3 and not p_manual then return null; end if;
  if saved.result is null or p_manual then
    update public.profile_normalization_inputs set attempts = attempts + 1
      where user_id = p_user_id and subject_key = subject and fingerprint = p_fingerprint;
  end if;
  update public.profile_normalization_leases set lease_id = token, lease_expires_at = clock_timestamp() + interval '10 minutes', fingerprint = p_fingerprint
    where user_id = p_user_id and subject_key = subject;
  return jsonb_build_object('lease_id', token, 'cached', saved.result is not null and not p_manual, 'result', case when not p_manual then saved.result else null end);
end $$;

create or replace function public.check_profile_normalization_input(p_user_id uuid, p_contact_id uuid, p_fingerprint text, p_lease_id uuid)
returns boolean language sql security definer set search_path = public, pg_temp as $$
  select exists(select 1 from public.profile_normalization_leases
    where user_id = p_user_id and subject_key = coalesce(p_contact_id::text, 'owner')
      and fingerprint = p_fingerprint and lease_id = p_lease_id and lease_expires_at > clock_timestamp());
$$;

create or replace function public.stage_profile_normalization_input(p_user_id uuid, p_contact_id uuid, p_fingerprint text, p_lease_id uuid, p_result jsonb)
returns boolean language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform 1 from public.profile_normalization_leases where user_id = p_user_id and subject_key = coalesce(p_contact_id::text, 'owner') for update;
  if not public.check_profile_normalization_input(p_user_id, p_contact_id, p_fingerprint, p_lease_id) then return false; end if;
  if p_result is null or jsonb_typeof(p_result->'groups') is distinct from 'array' then raise exception 'Invalid normalization result'; end if;
  update public.profile_normalization_inputs set result = p_result, evaluated_at = clock_timestamp(), completed_at = null
    where user_id = p_user_id and subject_key = coalesce(p_contact_id::text, 'owner') and fingerprint = p_fingerprint;
  return true;
end $$;

create or replace function public.finish_profile_normalization_input(p_user_id uuid, p_contact_id uuid, p_fingerprint text, p_lease_id uuid)
returns boolean language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform 1 from public.profile_normalization_leases where user_id = p_user_id and subject_key = coalesce(p_contact_id::text, 'owner') for update;
  if not public.check_profile_normalization_input(p_user_id, p_contact_id, p_fingerprint, p_lease_id) then return false; end if;
  update public.profile_normalization_inputs set completed_at = clock_timestamp()
    where user_id = p_user_id and subject_key = coalesce(p_contact_id::text, 'owner') and fingerprint = p_fingerprint and result is not null;
  if not found then return false; end if;
  update public.profile_normalization_leases set lease_id = null, lease_expires_at = null
    where user_id = p_user_id and subject_key = coalesce(p_contact_id::text, 'owner');
  return true;
end $$;

-- A refused balance gate made no provider call. Keep the short parking lease,
-- but do not consume a paid-attempt allowance. Invalidate its token for replay.
create or replace function public.defer_profile_normalization_input(p_user_id uuid, p_contact_id uuid, p_fingerprint text, p_lease_id uuid)
returns boolean language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform 1 from public.profile_normalization_leases where user_id = p_user_id and subject_key = coalesce(p_contact_id::text, 'owner') for update;
  if not public.check_profile_normalization_input(p_user_id, p_contact_id, p_fingerprint, p_lease_id) then return false; end if;
  update public.profile_normalization_inputs set attempts = greatest(0, attempts - 1)
    where user_id = p_user_id and subject_key = coalesce(p_contact_id::text, 'owner') and fingerprint = p_fingerprint;
  update public.profile_normalization_leases set fingerprint = null
    where user_id = p_user_id and subject_key = coalesce(p_contact_id::text, 'owner');
  return true;
end $$;
revoke all on function public.defer_profile_normalization_input(uuid,uuid,text,uuid) from public, anon, authenticated;
grant execute on function public.defer_profile_normalization_input(uuid,uuid,text,uuid) to service_role;

revoke all on function public.claim_profile_normalization_input(uuid,uuid,text,boolean), public.check_profile_normalization_input(uuid,uuid,text,uuid), public.stage_profile_normalization_input(uuid,uuid,text,uuid,jsonb), public.finish_profile_normalization_input(uuid,uuid,text,uuid) from public, anon, authenticated;
grant execute on function public.claim_profile_normalization_input(uuid,uuid,text,boolean), public.check_profile_normalization_input(uuid,uuid,text,uuid), public.stage_profile_normalization_input(uuid,uuid,text,uuid,jsonb), public.finish_profile_normalization_input(uuid,uuid,text,uuid) to service_role;
