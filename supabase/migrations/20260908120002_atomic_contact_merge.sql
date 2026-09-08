-- One transaction owns the merge and its durable external-sync intent.
create table public.contact_merge_receipts (
 user_id uuid not null, request_id uuid not null, payload jsonb not null,
 result jsonb not null, source_snapshot jsonb not null, created_at timestamptz not null default now(),
 primary key(user_id,request_id)
);
alter table public.contact_merge_receipts enable row level security;
create policy own_merge_receipts on public.contact_merge_receipts for select to authenticated using(user_id=auth.uid());
grant select on public.contact_merge_receipts to authenticated;
create table public.contact_merge_vault_jobs (
 id uuid primary key default gen_random_uuid(), user_id uuid not null, request_id uuid not null,
 source_contact_id uuid not null, target_contact_id uuid, status text not null default 'pending' check(status in ('pending','done')),
 created_at timestamptz not null default now(), completed_at timestamptz,
 unique(user_id,request_id), foreign key(user_id,request_id) references public.contact_merge_receipts(user_id,request_id) on delete cascade
);
alter table public.contact_merge_vault_jobs enable row level security;
create policy own_merge_vault_jobs on public.contact_merge_vault_jobs for select to authenticated using(user_id=auth.uid());
grant select on public.contact_merge_vault_jobs to authenticated;
grant all on public.contact_merge_vault_jobs to service_role;
-- A self merge preserves interaction history under the user's own profile.
alter table public.contact_interactions alter column contact_id drop not null;

create function public.merge_contacts_atomic(p_request_id uuid,p_source_contact_id uuid,p_target_contact_id uuid default null,p_merge_into_self boolean default false)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
 u uuid:=auth.uid(); s public.contacts; t public.contacts; c record; e record; n record;
 dest uuid; cat uuid; rel_source uuid; rel_target uuid; rel_source_type text; rel_target_type text; meta jsonb; arr jsonb; result_json jsonb; snapshot jsonb;
 payload_json jsonb:=jsonb_build_object('source',p_source_contact_id,'target',p_target_contact_id,'self',p_merge_into_self);
 receipt public.contact_merge_receipts; names text[]; mappings jsonb; pair record;
begin
 if u is null then raise exception 'Authentication required' using errcode='42501'; end if;
 if p_request_id is null or p_source_contact_id is null or p_merge_into_self is null
 or (p_merge_into_self and p_target_contact_id is not null)
 or (not p_merge_into_self and (p_target_contact_id is null or p_source_contact_id=p_target_contact_id)) then
  raise exception 'Invalid merge request' using errcode='22023';
 end if;
 -- Exclusive first: the existing contact statement trigger takes this same lock.
 -- Acquiring shared then upgrading after row locks would deadlock topic commands.
 perform pg_advisory_xact_lock(hashtextextended('contact-topics-lifecycle',0));
 perform pg_advisory_xact_lock(hashtextextended('contact-topics:'||u::text,0));
 select * into receipt from public.contact_merge_receipts where user_id=u and request_id=p_request_id;
 if found then
  if receipt.payload<>payload_json then raise exception 'Request ID already used for another merge' using errcode='22023'; end if;
  return receipt.result||jsonb_build_object('replayed',true);
 end if;
 perform id from public.contacts where user_id=u and id in(p_source_contact_id,p_target_contact_id) order by id for update;
 select * into s from public.contacts where id=p_source_contact_id and user_id=u;
 if not found or s.merged_into is not null then raise exception 'Source not found or already merged' using errcode='PT409'; end if;
 if s.topic_self_merge_pending and not p_merge_into_self then raise exception 'Finish the earlier self merge first' using errcode='PT409'; end if;
 dest:=case when p_merge_into_self then null else p_target_contact_id end;
 if p_merge_into_self then
  if exists(select from public.contact_topics where user_id=u and contact_id=s.id) then
   raise exception 'Reassign conversation topics before merging into yourself' using errcode='PT409';
  end if;
 else
  select * into t from public.contacts where id=dest and user_id=u;
  if not found or t.merged_into is not null or t.topic_self_merge_pending then raise exception 'Target not found or already merged' using errcode='PT409'; end if;
 end if;
 -- Keep exact source records, including provenance suppressed by the existing
 -- profile normalization trigger, in an owner-readable immutable receipt.
 snapshot:=jsonb_build_object('contact',to_jsonb(s),
  'categories',coalesce((select jsonb_agg(to_jsonb(x)) from public.profile_categories x where user_id=u and contact_id=s.id),'[]'::jsonb),
  'relationships',coalesce((select jsonb_agg(to_jsonb(x)) from public.contact_relationships x where user_id=u),'[]'::jsonb),
  'memberships',coalesce((select jsonb_agg(to_jsonb(x)) from public.contact_group_memberships x where user_id=u and contact_id=s.id),'[]'::jsonb),
  'entries',coalesce((select jsonb_agg(to_jsonb(x)) from public.profile_entries x where user_id=u and contact_id=s.id),'[]'::jsonb));
 names:=array(select lower(x) from unnest(array[s.name]||coalesce(s.aliases,'{}'::text[])) x);
 if not p_merge_into_self then
  mappings:=coalesce(t.app_mappings,'{}'::jsonb);
  for pair in select * from jsonb_each(coalesce(s.app_mappings,'{}'::jsonb)) loop
   if coalesce(mappings->pair.key->>'display_name','')='' then mappings:=mappings||jsonb_build_object(pair.key,pair.value); end if;
  end loop;
  update public.contacts set aliases=array(select distinct x from unnest(coalesce(t.aliases,'{}'::text[])||array[s.name]||coalesce(s.aliases,'{}'::text[])) x where x is not null and lower(x)<>lower(t.name)),
   app_mappings=mappings, notes=case when nullif(trim(s.notes),'') is null then t.notes when nullif(trim(t.notes),'') is null then s.notes else t.notes||E'\n\n--- Merged from '||s.name||E' ---\n'||s.notes end where id=dest;
 end if;
 for c in select * from public.profile_categories where user_id=u and contact_id=s.id order by id for update loop
  select id into cat from public.profile_categories where user_id=u and contact_id is not distinct from dest and slug=c.slug order by id limit 1 for update;
  if cat is null then
   update public.profile_categories set contact_id=dest where id=c.id;
   cat:=c.id;
  end if;
  for e in select * from public.profile_entries where user_id=u and category_id=c.id and contact_id=s.id order by id for update loop
   if exists(select from public.profile_entries z where z.user_id=u and z.contact_id is not distinct from dest and
    public.profile_fact_label_key(z.label)=public.profile_fact_label_key(e.label) and public.profile_fact_text_key(z.value)=public.profile_fact_text_key(e.value)) then
    delete from public.profile_entries where id=e.id;
   else
    update public.profile_entries set category_id=cat,contact_id=dest where id=e.id;
    -- Existing normalization can return NULL for an absorbed fact. Its complete
    -- original remains in the receipt; remove only that identified source row.
    if exists(select from public.profile_entries where id=e.id and contact_id=s.id) then delete from public.profile_entries where id=e.id; end if;
   end if;
  end loop;
  if cat<>c.id then
   if exists(select from public.profile_entries where category_id=c.id) then raise exception 'Unmoved category entries' using errcode='PT409'; end if;
   delete from public.profile_categories where id=c.id;
  end if;
 end loop;
 if exists(select from public.profile_entries where user_id=u and contact_id=s.id) then raise exception 'Unmoved profile entries' using errcode='PT409'; end if;
 if p_merge_into_self then
  select id into cat from public.profile_categories where user_id=u and contact_id is null and slug='identity' order by id limit 1;
  if cat is null then
   insert into public.profile_categories(user_id,contact_id,slug,name) values(u,null,'identity','Identity') returning id into cat;
  end if;
  insert into public.profile_entries(user_id,contact_id,category_id,label,value,sort_order,origin)
   select u,null,cat,'Also known as',x,99,'user_manual' from unnest(array[s.name]||coalesce(s.aliases,'{}'::text[])) x
   where nullif(trim(x),'') is not null on conflict do nothing;
 end if;
 update public.action_items set contact_id=dest where user_id=u and contact_id=s.id;
 update public.contact_interactions set contact_id=dest where user_id=u and contact_id=s.id;
 for e in select * from public.contact_group_memberships where user_id=u and contact_id=s.id order by id for update loop
  if dest is null or exists(select from public.contact_group_memberships where user_id=u and contact_id=dest and group_id=e.group_id) then
   delete from public.contact_group_memberships where id=e.id;
  else
   update public.contact_group_memberships set contact_id=dest where id=e.id;
  end if;
 end loop;
 for e in select * from public.contact_relationships where user_id=u and (source_id=s.id or target_id=s.id) order by id for update loop
  rel_source:=case when e.source_id=s.id then dest else e.source_id end;
  rel_target:=case when e.target_id=s.id then dest else e.target_id end;
  rel_source_type:=case when rel_source is null then 'self' else 'contact' end;
  rel_target_type:=case when rel_target is null then 'self' else 'contact' end;
  if rel_source is not distinct from rel_target or exists(
   select from public.contact_relationships r where r.user_id=u and r.id<>e.id
   and public.relationship_pair_key(u,r.source_type,r.source_id,r.target_type,r.target_id,r.label)
     =public.relationship_pair_key(u,rel_source_type,rel_source,rel_target_type,rel_target,e.label)) then
   delete from public.contact_relationships where id=e.id;
  else
   update public.contact_relationships set source_id=rel_source,target_id=rel_target,source_type=rel_source_type,target_type=rel_target_type where id=e.id;
   -- Normalization/rejection triggers may suppress an UPDATE. Preserve the
   -- original in the receipt and remove it from the retired source explicitly.
   if exists(select from public.contact_relationships where id=e.id and (source_id=s.id or target_id=s.id)) then
    delete from public.contact_relationships where id=e.id;
   end if;
  end if;
 end loop;
 -- All matching notes, including trashed notes, are handled inside PostgreSQL.
 -- No REST row cap, offset, or client-side page can omit a reference.
 for n in select id,metadata from public.notes where user_id=u and (
  metadata->'matched_people' @> jsonb_build_array(jsonb_build_object('contact_id',s.id))
  or exists(select from jsonb_array_elements(case when jsonb_typeof(metadata->'people')='array' then metadata->'people' else '[]'::jsonb end) x where lower(x#>>'{}')=any(names))) order by id for update loop
  meta:=n.metadata;
  if jsonb_typeof(meta->'people')='array' then
   select coalesce(jsonb_agg(v order by ord),'[]'::jsonb) into arr from (
    select v,min(ord) ord from (
     select case when lower(value#>>'{}')=any(names) then case when dest is null then null else to_jsonb(t.name) end else value end v,ordinality ord
     from jsonb_array_elements(meta->'people') with ordinality) a where v is not null group by v) b;
   meta:=jsonb_set(meta,'{people}',arr);
  end if;
  if jsonb_typeof(meta->'matched_people')='array' then
   select coalesce(jsonb_agg(v order by ord),'[]'::jsonb) into arr from (
    select case when value->>'contact_id'=s.id::text then case when dest is null then null else value||jsonb_build_object('contact_id',dest,'canonical_name',t.name) end else value end v,ordinality ord
    from jsonb_array_elements(meta->'matched_people') with ordinality) a where v is not null;
   meta:=jsonb_set(meta,'{matched_people}',arr);
  end if;
  update public.notes set metadata=meta where id=n.id;
 end loop;
 -- The existing trigger transfers topic rows and writes their lifecycle events.
 update public.contacts set merged_into=coalesce(dest,s.id),merged_at=clock_timestamp(),topic_self_merge_pending=false where id=s.id;
 update public.github_sync_log set sync_status='pending' where user_id=u and entity_type='person' and entity_id in(s.id,dest);
 result_json:=jsonb_build_object('ok',true,'replayed',false,'request_id',p_request_id,'merged',jsonb_build_object('source',s.name,'target',case when dest is null then 'user profile' else t.name end));
 insert into public.contact_merge_receipts(user_id,request_id,payload,result,source_snapshot) values(u,p_request_id,payload_json,result_json,snapshot);
 insert into public.contact_merge_vault_jobs(user_id,request_id,source_contact_id,target_contact_id) values(u,p_request_id,s.id,dest);
 return result_json;
end $$;
revoke all on function public.merge_contacts_atomic(uuid,uuid,uuid,boolean) from public,anon,service_role;
grant execute on function public.merge_contacts_atomic(uuid,uuid,uuid,boolean) to authenticated;





