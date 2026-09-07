-- Authorized UI capture only. No archive scan, metadata marker or broad trigger.
-- The note and its first subscription either both commit or both roll back.
-- ID-only receipts survive note deletion so an old offline PUT cannot resurrect
-- deleted data. No note content, no backfill and no auto-expiry (offline replay
-- has no bounded age). Account deletion should remove these with other user data.
create table public.note_capture_receipts (
 note_id uuid primary key,
 user_id uuid not null references auth.users(id) on delete cascade,
 created_at timestamptz not null default now()
);
alter table public.note_capture_receipts enable row level security;
revoke all on public.note_capture_receipts from public,anon,authenticated;
create policy note_capture_receipts_owner_read on public.note_capture_receipts for select to authenticated using(user_id=auth.uid());
create policy note_capture_receipts_owner_insert on public.note_capture_receipts for insert to authenticated with check(user_id=auth.uid());
grant select,insert on public.note_capture_receipts to authenticated;
grant all on public.note_capture_receipts to service_role;

create function public.capture_note_with_lexicon(_note jsonb) returns jsonb
language plpgsql security invoker set search_path=public,pg_temp as $$
<<capture>>
declare
 owner_id uuid := auth.uid();
 note_id uuid;
 saved public.notes;
 columns_sql text;
 inserted boolean;
begin
 if auth.role() is distinct from 'authenticated' or owner_id is null then
  raise exception 'authenticated capture required' using errcode='42501';
 end if;
 if _note is null or jsonb_typeof(_note) <> 'object' then
  raise exception 'note object required' using errcode='22023';
 end if;
 if _note ? 'user_id' and (_note->>'user_id')::uuid is distinct from owner_id then
  raise exception 'note owner mismatch' using errcode='42501';
 end if;
 if exists(select 1 from jsonb_object_keys(_note) k where k <> all(array[
  'id','user_id','title','content','metadata','tags','is_favorite','is_pinned',
  'is_trashed','trashed_at','entity_type','source_app','source_id','source_url',
  'folder_path','is_external','sync_status','structured_fields','related','ai_visibility','created_at'
 ])) then raise exception 'unsupported capture field' using errcode='22023'; end if;
 note_id := coalesce((_note->>'id')::uuid,gen_random_uuid());
 insert into public.note_capture_receipts(note_id,user_id) values(note_id,owner_id) on conflict do nothing;
 if not found then
  if not exists(select 1 from public.note_capture_receipts r where r.note_id=capture.note_id and r.user_id=owner_id) then
   raise exception 'capture id unavailable' using errcode='42501';
  end if;
  select * into saved from public.notes where id=note_id and user_id=owner_id;
  if not found then return null; end if;
  return to_jsonb(saved);
 end if;
 _note := _note || jsonb_build_object('id',note_id,'user_id',owner_id);
 -- Only provided columns are inserted; omitted fields keep database defaults.
 -- Identifiers come from the allowlist and are quoted; values stay parameters.
 select string_agg(format('%I',k),',' order by k) into columns_sql from jsonb_object_keys(_note) k;
 execute format('insert into public.notes (%1$s) select %1$s from jsonb_populate_record(null::public.notes,$1) on conflict(id) do nothing returning *',columns_sql)
  into saved using _note;
 inserted := saved.id is not null;
 if not inserted then
  -- A lost response/retried offline PUT must never restore an older body.
  -- Existing historical notes are not silently enrolled by this capture path.
  select * into saved from public.notes where id=note_id and user_id=owner_id;
  if not found then raise exception 'capture id unavailable' using errcode='42501'; end if;
 elsif nullif(trim(saved.source_app),'') is null and not coalesce(saved.is_external,false)
   and not coalesce(saved.is_trashed,false) and saved.ai_visibility <> 'hidden' then
  begin
   if public.enqueue_note_ai_job(owner_id,note_id,'lexicon','automatic') is null then
    raise exception 'capture enrollment unavailable';
   end if;
  exception when others then
   -- A queue deployment/constraint failure is not malformed user note data.
   -- Keep PowerSync's transaction pending instead of its fatal-op discard path.
   raise exception 'capture enrollment unavailable' using errcode='40001';
  end;
 end if;
 return to_jsonb(saved);
end $$;
revoke all on function public.capture_note_with_lexicon(jsonb) from public,anon,service_role;
grant execute on function public.capture_note_with_lexicon(jsonb) to authenticated;
