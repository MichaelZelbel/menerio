-- Durable, additive queue. No historical enrollment and no scheduled execution here.
create table public.note_ai_jobs (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null, note_id uuid not null references public.notes(id) on delete cascade,
 pipeline text not null check (pipeline in ('analysis','lexicon')),
 desired_generation bigint not null default 1, captured_generation bigint, policy_epoch bigint not null default 0,
 desired_fingerprint text not null, fingerprint text,
 state text not null default 'pending' check (state in ('pending','running','completed','failed','parked')),
 first_dirty_at timestamptz not null default now(), last_dirty_at timestamptz not null default now(),
 next_eligible_at timestamptz not null default now()+interval '2 minutes',
 last_automatic_start timestamptz, last_claimed_at timestamptz, attempts integer not null default 0,
 lease_id uuid, lease_expires_at timestamptz, execution_started_at timestamptz, snapshot jsonb,
 priority boolean not null default false, last_error text,
 unique(user_id,note_id,pipeline)
);
create index note_ai_jobs_due on public.note_ai_jobs(next_eligible_at,user_id) where state in ('pending','parked','running');
alter table public.note_ai_jobs enable row level security;
create policy note_ai_jobs_owner_read on public.note_ai_jobs for select to authenticated using(user_id=auth.uid());
grant select on public.note_ai_jobs to authenticated;
grant all on public.note_ai_jobs to service_role;

-- Only input-bearing fields participate. Metadata/tags/embeddings are outputs.
create function public.note_ai_input(_user_id uuid,_note_id uuid,_pipeline text) returns jsonb
language sql stable security definer set search_path=public,pg_temp as $$
 select jsonb_build_object('id',n.id,'user_id',n.user_id,'title',n.title,'content',n.content,
  'source_app',n.source_app,'is_external',n.is_external,'ai_visibility',n.ai_visibility,
  'created_at',n.created_at,'metadata',n.metadata,'policy_version','note-ai-v1',
  'policy_epoch',coalesce((select policy_epoch from public.note_ai_jobs where user_id=n.user_id and note_id=n.id and pipeline=_pipeline),0),
  'extract_facts',n.ai_visibility <> 'hidden' and lower(trim(coalesce(n.source_app,''))) <> 'hub',
  'media',coalesce((select jsonb_agg(jsonb_build_object('id',m.id,'extracted_text',m.extracted_text,
   'description',m.description,'topics',m.topics) order by m.id)
   from public.media_analysis m where m.note_id=n.id and m.user_id=n.user_id and m.analysis_status='complete'),'[]'::jsonb))
 from public.notes n where n.id=_note_id and n.user_id=_user_id and not coalesce(n.is_trashed,false)
 and (_pipeline='analysis' or (_pipeline='lexicon' and n.ai_visibility <> 'hidden' and lower(trim(coalesce(n.source_app,''))) <> 'hub'))
$$;
create function public.note_ai_fingerprint(_input jsonb) returns text
language sql immutable set search_path=public,extensions,pg_temp as $$
 select encode(extensions.digest(((_input-'metadata'-'created_at') || jsonb_build_object('is_quick_capture',_input->'metadata'->'is_quick_capture'))::text,'sha256'),'hex')
$$;
create function public.enqueue_note_ai_job(_user_id uuid,_note_id uuid,_pipeline text,_reason text default 'automatic') returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare s jsonb; f text; j public.note_ai_jobs; t timestamptz:=clock_timestamp();
begin
 if coalesce(auth.role(),'') <> 'service_role' and auth.uid() is distinct from _user_id then raise exception 'not authorized' using errcode='42501'; end if;
 if _pipeline not in ('analysis','lexicon') or _reason not in ('automatic','manual') then raise exception 'invalid queue request' using errcode='22023'; end if;
 -- Same lock order as ordinary note update -> trigger -> job.
 perform 1 from public.notes where id=_note_id and user_id=_user_id for update;
 s:=public.note_ai_input(_user_id,_note_id,_pipeline);
 if s is null then return null; end if;
 f:=public.note_ai_fingerprint(s);
 insert into public.note_ai_jobs(user_id,note_id,pipeline,desired_fingerprint,first_dirty_at,last_dirty_at,next_eligible_at,priority)
 values(_user_id,_note_id,_pipeline,f,t,t,case when _reason='manual' then t else t+interval '2 minutes' end,_reason='manual')
 on conflict(user_id,note_id,pipeline) do nothing;
 select * into j from public.note_ai_jobs where user_id=_user_id and note_id=_note_id and pipeline=_pipeline for update;
 if j.desired_fingerprint is distinct from f then
  update public.note_ai_jobs set desired_generation=desired_generation+1,desired_fingerprint=f,
   first_dirty_at=case when state in ('completed','failed') or (state='running' and captured_generation=desired_generation) then t else first_dirty_at end,
   last_dirty_at=t,attempts=case when state='running' then attempts else 0 end,
   state=case when state in ('running','parked') then state else 'pending' end,last_error=case when state='parked' then last_error else null end,
   next_eligible_at=greatest(case when state='parked' then next_eligible_at else '-infinity'::timestamptz end,least(t+interval '2 minutes',case when state in ('completed','failed') or (state='running' and captured_generation=desired_generation) then t+interval '15 minutes' else first_dirty_at+interval '15 minutes' end),coalesce(last_automatic_start+interval '10 minutes','-infinity'::timestamptz))
  where id=j.id returning * into j;
 end if;
 -- Eligibility can return (for example restoring trash) without a changed body.
 if j.state='failed' and j.last_error='ineligible' then
  update public.note_ai_jobs set state='pending',last_error=null,priority=false,first_dirty_at=t,last_dirty_at=t,
   next_eligible_at=greatest(t+interval '2 minutes',coalesce(last_automatic_start+interval '10 minutes','-infinity'::timestamptz))
  where id=j.id returning * into j;
 end if;
 -- Manual can wake a cheap parked balance probe, not reset failures or bypass a lease.
 if _reason='manual' and (j.state in ('pending','parked') or (j.state='running' and j.desired_generation>j.captured_generation)) and not j.priority then
  update public.note_ai_jobs set priority=true,next_eligible_at=t,state=case when state='parked' then 'pending' else state end where id=j.id returning * into j;
 end if;
 return to_jsonb(j);
end $$;
create function public.note_ai_note_changed() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if TG_OP='UPDATE' and row(new.title,new.content,new.source_app,new.is_external,new.ai_visibility,new.is_trashed,new.metadata->'is_quick_capture')
   is not distinct from row(old.title,old.content,old.source_app,old.is_external,old.ai_visibility,old.is_trashed,old.metadata->'is_quick_capture') then return new; end if;
 perform public.enqueue_note_ai_job(new.user_id,new.id,'analysis','automatic');
 if exists(select 1 from public.note_ai_jobs where user_id=new.user_id and note_id=new.id and pipeline='lexicon') then
  perform public.enqueue_note_ai_job(new.user_id,new.id,'lexicon','automatic');
 end if;
 return new;
end $$;
create trigger note_ai_note_changed after insert or update on public.notes for each row execute function public.note_ai_note_changed();

revoke all on function public.note_ai_input(uuid,uuid,text), public.note_ai_fingerprint(jsonb), public.note_ai_note_changed() from public,authenticated;
revoke all on function public.enqueue_note_ai_job(uuid,uuid,text,text) from public;
grant execute on function public.enqueue_note_ai_job(uuid,uuid,text,text) to authenticated,service_role;
grant execute on function public.note_ai_input(uuid,uuid,text), public.note_ai_fingerprint(jsonb) to service_role;

-- LEASES
create table public.note_ai_completions (
 job_id uuid not null references public.note_ai_jobs(id) on delete cascade,
 fingerprint text not null, generation bigint not null, completed_at timestamptz not null default now(),
 primary key(job_id,fingerprint)
);
alter table public.note_ai_completions enable row level security;
grant all on public.note_ai_completions to service_role;

create function public.claim_note_ai_jobs(_limit integer default 10,_lease_seconds integer default 300,_user_id uuid default null)
returns setof public.note_ai_jobs language plpgsql security definer set search_path=public,pg_temp as $$
declare j public.note_ai_jobs; s jsonb; t timestamptz:=clock_timestamp();
begin
 if coalesce(auth.role(),'') <> 'service_role' then raise exception 'service only' using errcode='42501'; end if;
 for j in with due as (
  select q.id,row_number() over(partition by q.user_id order by q.priority desc,q.next_eligible_at,q.id) as turn
  from public.note_ai_jobs q where (_user_id is null or q.user_id=_user_id)
  and ((q.state in ('pending','parked') and q.next_eligible_at<=t) or (q.state='running' and q.lease_expires_at<=t and (q.last_automatic_start is null or q.last_automatic_start+interval '10 minutes'<=t)))
 ) select q.* from public.note_ai_jobs q join due on due.id=q.id
  order by due.turn,(select max(h.last_claimed_at) from public.note_ai_jobs h where h.user_id=q.user_id) nulls first,q.priority desc,q.next_eligible_at,q.id
  limit greatest(0,least(coalesce(_limit,10),10)) for update of q skip locked
 loop
  s:=public.note_ai_input(j.user_id,j.note_id,j.pipeline);
  if s is null then
   update public.note_ai_jobs set state='failed',last_error='ineligible',lease_id=null,lease_expires_at=null,snapshot=null where id=j.id;
   continue;
  end if;
  if exists(select 1 from public.note_ai_completions where job_id=j.id and fingerprint=j.desired_fingerprint) then
   update public.note_ai_jobs set state='completed',lease_id=null,lease_expires_at=null,snapshot=null,priority=false where id=j.id;
   continue;
  end if;
  if j.captured_generation is distinct from j.desired_generation then j.attempts:=0; end if;
  if j.attempts>=3 then
   update public.note_ai_jobs set state='failed',last_error='attempt_limit',lease_id=null,lease_expires_at=null,snapshot=null where id=j.id;
   continue;
  end if;
  -- Input and generation must be from the same committed transaction.
  if public.note_ai_fingerprint(s) <> j.desired_fingerprint then continue; end if;
  update public.note_ai_jobs set state='running',captured_generation=desired_generation,
   fingerprint=desired_fingerprint,snapshot=s,lease_id=gen_random_uuid(),execution_started_at=null,
   lease_expires_at=t+make_interval(secs=>greatest(30,least(coalesce(_lease_seconds,300),900))),
   attempts=j.attempts+1,last_claimed_at=t,last_automatic_start=case when priority then last_automatic_start else t end,
   priority=false,last_error=case when j.state='running' then 'lease_expired' else last_error end
  where id=j.id returning * into j;
  return next j;
 end loop;
end $$;

create function public.get_note_ai_job_snapshot(_user_id uuid,_job_id uuid,_lease_id uuid) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare j public.note_ai_jobs; current_input jsonb;
begin
 if coalesce(auth.role(),'') <> 'service_role' then raise exception 'service only' using errcode='42501'; end if;
 select * into j from public.note_ai_jobs where id=_job_id and user_id=_user_id and lease_id=_lease_id
  and state='running' and lease_expires_at>clock_timestamp();
 if not found then return null; end if;
 current_input:=public.note_ai_input(j.user_id,j.note_id,j.pipeline);
 if current_input is null or current_input->'extract_facts' is distinct from j.snapshot->'extract_facts'
  or current_input->'ai_visibility' is distinct from j.snapshot->'ai_visibility'
  or current_input->'source_app' is distinct from j.snapshot->'source_app' then return null; end if;
 return to_jsonb(j);
end $$;

create function public.finish_note_ai_job(_user_id uuid,_job_id uuid,_lease_id uuid) returns boolean
language plpgsql security definer set search_path=public,pg_temp as $$
declare j public.note_ai_jobs;
begin
 if coalesce(auth.role(),'') <> 'service_role' then raise exception 'service only' using errcode='42501'; end if;
 select * into j from public.note_ai_jobs where id=_job_id and user_id=_user_id for update;
 if not found or j.lease_id is distinct from _lease_id or j.state<>'running' or j.lease_expires_at<=clock_timestamp() then return false; end if;
 if exists(select 1 from public.note_ai_stage_results where job_id=j.id and fingerprint=j.fingerprint and status in ('started','uncertain')) then return false; end if;
 insert into public.note_ai_completions(job_id,fingerprint,generation) values(j.id,j.fingerprint,j.captured_generation) on conflict do nothing;
 update public.note_ai_jobs set state=case when desired_generation=j.captured_generation then 'completed' else 'pending' end,
  snapshot=null,lease_id=null,lease_expires_at=null,attempts=0,priority=(priority and desired_generation>j.captured_generation),last_error=null,
  next_eligible_at=case when priority and desired_generation>j.captured_generation then clock_timestamp() else greatest(least(last_dirty_at+interval '2 minutes',first_dirty_at+interval '15 minutes'),coalesce(last_automatic_start+interval '10 minutes','-infinity'::timestamptz)) end
 where id=j.id;
 delete from public.note_ai_completions where job_id=j.id and (completed_at<now()-interval '30 days' or fingerprint in
  (select fingerprint from public.note_ai_completions where job_id=j.id order by completed_at desc offset 20));
 return true;
end $$;
revoke all on function public.claim_note_ai_jobs(integer,integer,uuid),public.get_note_ai_job_snapshot(uuid,uuid,uuid),public.finish_note_ai_job(uuid,uuid,uuid) from public,authenticated;
grant execute on function public.claim_note_ai_jobs(integer,integer,uuid),public.get_note_ai_job_snapshot(uuid,uuid,uuid),public.finish_note_ai_job(uuid,uuid,uuid) to service_role;

-- STAGES
create table public.note_ai_stage_results (
 job_id uuid not null references public.note_ai_jobs(id) on delete cascade,
 fingerprint text not null, stage text not null check(length(stage) between 1 and 80),
 status text not null check(status in ('started','checkpointed','applied','uncertain')),
 lease_id uuid not null, result jsonb, updated_at timestamptz not null default now(),
 primary key(job_id,fingerprint,stage), check(result is null or octet_length(result::text)<=1048576)
);
alter table public.note_ai_stage_results enable row level security;
grant all on public.note_ai_stage_results to service_role;

create function public.begin_note_ai_stage(_user_id uuid,_job_id uuid,_lease_id uuid,_stage text) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare j public.note_ai_jobs; r public.note_ai_stage_results;
begin
 if coalesce(auth.role(),'') <> 'service_role' then raise exception 'service only' using errcode='42501'; end if;
 select * into j from public.note_ai_jobs where id=_job_id and user_id=_user_id for update;
 if not found or public.get_note_ai_job_snapshot(_user_id,_job_id,_lease_id) is null then return null; end if;
 insert into public.note_ai_stage_results(job_id,fingerprint,stage,status,lease_id)
 values(j.id,j.fingerprint,_stage,'started',_lease_id) on conflict do nothing;
 if found then return jsonb_build_object('status','started','result',null); end if;
 select * into r from public.note_ai_stage_results where job_id=j.id and fingerprint=j.fingerprint and stage=_stage;
 if r.status='started' and r.lease_id=_lease_id then return jsonb_build_object('status','busy','result',null); end if;
 if r.status='started' and r.lease_id<>_lease_id then
  update public.note_ai_stage_results set status='uncertain',updated_at=clock_timestamp()
   where job_id=j.id and fingerprint=j.fingerprint and stage=_stage returning * into r;
 end if;
 return jsonb_build_object('status',r.status,'result',r.result);
end $$;
create function public.checkpoint_note_ai_stage(_user_id uuid,_job_id uuid,_lease_id uuid,_stage text,_result jsonb) returns boolean
language plpgsql security definer set search_path=public,pg_temp as $$
declare j public.note_ai_jobs;
begin
 if coalesce(auth.role(),'') <> 'service_role' then raise exception 'service only' using errcode='42501'; end if;
 select * into j from public.note_ai_jobs where id=_job_id and user_id=_user_id for update;
 if not found or public.get_note_ai_job_snapshot(_user_id,_job_id,_lease_id) is null then return false; end if;
 update public.note_ai_stage_results set status='checkpointed',result=_result,updated_at=clock_timestamp()
 where job_id=j.id and fingerprint=j.fingerprint and stage=_stage and status='started' and lease_id=_lease_id;
 return found;
end $$;
create function public.apply_note_ai_stage(_user_id uuid,_job_id uuid,_lease_id uuid,_stage text) returns boolean
language plpgsql security definer set search_path=public,pg_temp as $$
declare j public.note_ai_jobs;
begin
 if coalesce(auth.role(),'') <> 'service_role' then raise exception 'service only' using errcode='42501'; end if;
 select * into j from public.note_ai_jobs where id=_job_id and user_id=_user_id for update;
 if not found or public.get_note_ai_job_snapshot(_user_id,_job_id,_lease_id) is null or j.captured_generation<>j.desired_generation then return false; end if;
 update public.note_ai_stage_results set status='applied',updated_at=clock_timestamp()
 where job_id=j.id and fingerprint=j.fingerprint and stage=_stage and status in ('checkpointed','applied');
 return found;
end $$;

create function public.fail_note_ai_job(_user_id uuid,_job_id uuid,_lease_id uuid,_kind text) returns boolean
language plpgsql security definer set search_path=public,pg_temp as $$
declare j public.note_ai_jobs; t timestamptz:=clock_timestamp(); newer boolean;
begin
 if coalesce(auth.role(),'') <> 'service_role' then raise exception 'service only' using errcode='42501'; end if;
 if _kind not in ('transient','permanent','no_credit','uncertain') then raise exception 'invalid failure kind' using errcode='22023'; end if;
 select * into j from public.note_ai_jobs where id=_job_id and user_id=_user_id for update;
 if not found or j.lease_id is distinct from _lease_id or j.state<>'running' or j.lease_expires_at<=t then return false; end if;
 newer:=j.desired_generation<>j.captured_generation;
 update public.note_ai_jobs set
  state=case when _kind='no_credit' then 'parked' when newer then 'pending' when _kind in ('permanent','uncertain') or j.attempts>=3 then 'failed' else 'pending' end,
  last_error=_kind,snapshot=null,lease_id=null,lease_expires_at=null,priority=false,
  attempts=case when newer then 0 when _kind='no_credit' then greatest(0,attempts-1) else attempts end,
  next_eligible_at=case when _kind='no_credit' then t+interval '1 hour' else greatest(t+make_interval(secs=>60*power(2,least(j.attempts,3))::integer),
   least(last_dirty_at+interval '2 minutes',first_dirty_at+interval '15 minutes'),coalesce(last_automatic_start+interval '10 minutes','-infinity'::timestamptz)) end
 where id=j.id;
 -- A known transient/pre-provider failure allows retry. Uncertain outcomes retain a diagnostic fence.
 if _kind in ('transient','no_credit') then
  delete from public.note_ai_stage_results where job_id=j.id and fingerprint=j.fingerprint and status='started' and lease_id=_lease_id;
 elsif _kind='uncertain' then
  update public.note_ai_stage_results set status='uncertain',updated_at=t where job_id=j.id and fingerprint=j.fingerprint and status='started';
 end if;
 return true;
end $$;

-- Results survive stage application for downstream recovery, but not completed pipeline history.
create function public.note_ai_release_results() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if new.state in ('completed','pending') and old.state='running' and new.last_error is null then
  update public.note_ai_stage_results set result=null where job_id=new.id and fingerprint=old.fingerprint;
 end if;
 delete from public.note_ai_stage_results where job_id=new.id and (updated_at<now()-interval '30 days'
  or fingerprint in (select fingerprint from public.note_ai_stage_results where job_id=new.id group by fingerprint order by max(updated_at) desc offset 20));
 return new;
end $$;
create trigger note_ai_release_results after update on public.note_ai_jobs for each row execute function public.note_ai_release_results();
revoke all on function public.begin_note_ai_stage(uuid,uuid,uuid,text),public.checkpoint_note_ai_stage(uuid,uuid,uuid,text,jsonb),public.apply_note_ai_stage(uuid,uuid,uuid,text),public.fail_note_ai_job(uuid,uuid,uuid,text),public.note_ai_release_results() from public,authenticated;
grant execute on function public.begin_note_ai_stage(uuid,uuid,uuid,text),public.checkpoint_note_ai_stage(uuid,uuid,uuid,text,jsonb),public.apply_note_ai_stage(uuid,uuid,uuid,text),public.fail_note_ai_job(uuid,uuid,uuid,text) to service_role;

-- MEDIA
create function public.note_ai_media_changed() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if TG_OP='UPDATE' and row(new.note_id,new.user_id,new.analysis_status,new.extracted_text,new.description,new.topics)
  is not distinct from row(old.note_id,old.user_id,old.analysis_status,old.extracted_text,old.description,old.topics) then return new; end if;
 if TG_OP<>'INSERT' and old.analysis_status='complete' then
  perform public.enqueue_note_ai_job(old.user_id,old.note_id,'analysis','automatic');
  if exists(select 1 from public.note_ai_jobs where user_id=old.user_id and note_id=old.note_id and pipeline='lexicon') then
   perform public.enqueue_note_ai_job(old.user_id,old.note_id,'lexicon','automatic');
  end if;
 end if;
 if TG_OP<>'DELETE' and new.analysis_status='complete' then
  perform public.enqueue_note_ai_job(new.user_id,new.note_id,'analysis','automatic');
  if exists(select 1 from public.note_ai_jobs where user_id=new.user_id and note_id=new.note_id and pipeline='lexicon') then
   perform public.enqueue_note_ai_job(new.user_id,new.note_id,'lexicon','automatic');
  end if;
 end if;
 if TG_OP='DELETE' then return old; end if;
 return new;
end $$;
create trigger note_ai_media_changed after insert or update or delete on public.media_analysis for each row execute function public.note_ai_media_changed();
revoke all on function public.note_ai_media_changed() from public,authenticated;

-- EXECUTION
create function public.claim_note_ai_execution(_user_id uuid,_job_id uuid,_lease_id uuid) returns boolean
language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if coalesce(auth.role(),'') <> 'service_role' then raise exception 'service only' using errcode='42501'; end if;
 update public.note_ai_jobs set execution_started_at=clock_timestamp()
 where id=_job_id and user_id=_user_id and lease_id=_lease_id and state='running'
  and lease_expires_at>clock_timestamp() and execution_started_at is null
  and public.get_note_ai_job_snapshot(_user_id,_job_id,_lease_id) is not null;
 return found;
end $$;
revoke all on function public.claim_note_ai_execution(uuid,uuid,uuid) from public,authenticated;
grant execute on function public.claim_note_ai_execution(uuid,uuid,uuid) to service_role;

-- ADMIN_REANALYSIS
-- The Edge endpoint verifies administrator identity; this RPC is never owner-callable.
create function public.reanalyze_note_ai_job(_user_id uuid,_note_id uuid,_pipeline text) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare j public.note_ai_jobs; s jsonb; t timestamptz:=clock_timestamp();
begin
 if coalesce(auth.role(),'') <> 'service_role' then raise exception 'service only' using errcode='42501'; end if;
 perform 1 from public.notes where id=_note_id and user_id=_user_id for update;
 select * into j from public.note_ai_jobs where user_id=_user_id and note_id=_note_id and pipeline=_pipeline for update;
 if found and j.state='running' then return to_jsonb(j); end if;
 if public.enqueue_note_ai_job(_user_id,_note_id,_pipeline,'manual') is null then return null; end if;
 update public.note_ai_jobs set policy_epoch=policy_epoch+1 where user_id=_user_id and note_id=_note_id and pipeline=_pipeline returning * into j;
 s:=public.note_ai_input(_user_id,_note_id,_pipeline);
 update public.note_ai_jobs set desired_generation=desired_generation+1,desired_fingerprint=public.note_ai_fingerprint(s),
  state='pending',attempts=0,priority=true,last_error=null,first_dirty_at=t,last_dirty_at=t,next_eligible_at=t,
  snapshot=null,lease_id=null,lease_expires_at=null,execution_started_at=null
 where id=j.id returning * into j;
 return to_jsonb(j);
end $$;
revoke all on function public.reanalyze_note_ai_job(uuid,uuid,text) from public,authenticated;
grant execute on function public.reanalyze_note_ai_job(uuid,uuid,text) to service_role;
