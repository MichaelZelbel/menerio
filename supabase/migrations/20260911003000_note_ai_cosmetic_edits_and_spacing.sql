-- Cosmetic edits are not new content, and a note kept open all day settles into a few runs.
--
-- What happened. On 2026-09-10 one checklist note was saved 182 times because its
-- owner ticked boxes through the day. The fingerprint is a hash over the raw body,
-- so "- [ ]" becoming "- [x]" was a new revision each time; the worker coalesced
-- the saves into 17 full pipeline runs (metadata, embeddings, Lexicon ingest),
-- about 210k tokens and 105 credits for a note that gained no sentence. The nine
-- journal notes of that fortnight cost 1,238 credits against a 1,500-credit month.
--
-- Two changes, both mirrored in _shared/note-ai-policy.ts:
--  1. The fingerprint hashes a normalized body: checkbox state, line endings,
--     trailing whitespace and runs of blank lines are ignored. Ticking a box is
--     now a no-op for the queue, as an unchanged save already was.
--  2. Quiet time after a revision 2 -> 10 minutes (a new note is still indexed
--     two minutes after capture), the continuous-editing cap 15 -> 60 minutes,
--     and the gap between automatic starts of one note doubles with every run
--     completed in the last 24 hours (analysis 10,20,40,80,120 min; Lexicon
--     1,2,4,6 h). Manual requests still ignore spacing.
-- Existing jobs are re-keyed with the new fingerprint so nothing is re-bought for
-- the migration itself.

create or replace function public.note_ai_normalize_text(_text text) returns text
language sql immutable parallel safe set search_path=public,pg_temp as $$
 select btrim(
  regexp_replace(
   regexp_replace(
    regexp_replace(
     regexp_replace(coalesce(_text,''), '\r\n?', E'\n', 'g'),
     '(^|\n)([ \t]*(?:[-*+]|[0-9]+[.)])[ \t]+)\[[xX ]\]', '\1\2[ ]', 'g'),
    '[ \t]+(\n|$)', '\1', 'g'),
   '\n{3,}', E'\n\n', 'g'),
  E' \t\n')
$$;

create or replace function public.note_ai_fingerprint(_input jsonb) returns text
language sql immutable set search_path=public,extensions,pg_temp as $$
 select encode(extensions.digest(((_input-'metadata'-'created_at')
  || jsonb_build_object('is_quick_capture',_input->'metadata'->'is_quick_capture',
                        'content',public.note_ai_normalize_text(_input->>'content')))::text,'sha256'),'hex')
$$;

-- Gap between automatic starts of one note/pipeline, from runs completed in the last day.
create or replace function public.note_ai_spacing(_job_id uuid,_pipeline text) returns interval
language sql stable set search_path=public,pg_temp as $$
 select case when _pipeline='lexicon'
  then least(interval '6 hours', interval '60 minutes' * power(2, least(c.n,10)))
  else least(interval '120 minutes', interval '10 minutes' * power(2, least(c.n,10))) end
 from (select count(*) as n from public.note_ai_completions
       where job_id=_job_id and completed_at>now()-interval '24 hours') c
$$;

create or replace function public.note_ai_next_eligible(_job_id uuid,_pipeline text,_first timestamptz,_last timestamptz,_last_auto timestamptz) returns timestamptz
language sql stable set search_path=public,pg_temp as $$
 select greatest(least(_last+interval '10 minutes',_first+interval '60 minutes'),
  coalesce(_last_auto+public.note_ai_spacing(_job_id,_pipeline),'-infinity'::timestamptz))
$$;

revoke all on function public.note_ai_normalize_text(text),public.note_ai_spacing(uuid,text),public.note_ai_next_eligible(uuid,text,timestamptz,timestamptz,timestamptz) from public,authenticated;
grant execute on function public.note_ai_normalize_text(text),public.note_ai_spacing(uuid,text),public.note_ai_next_eligible(uuid,text,timestamptz,timestamptz,timestamptz) to service_role;

create or replace function public.enqueue_note_ai_job(_user_id uuid,_note_id uuid,_pipeline text,_reason text default 'automatic') returns jsonb
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
 -- A brand-new note is indexed two minutes after capture; the ten-minute quiet time is for revisions.
 values(_user_id,_note_id,_pipeline,f,t,t,case when _reason='manual' then t else t+interval '2 minutes' end,_reason='manual')
 on conflict(user_id,note_id,pipeline) do nothing;
 select * into j from public.note_ai_jobs where user_id=_user_id and note_id=_note_id and pipeline=_pipeline for update;
 if j.desired_fingerprint is distinct from f then
  update public.note_ai_jobs set desired_generation=desired_generation+1,desired_fingerprint=f,
   first_dirty_at=case when state in ('completed','failed') or (state='running' and captured_generation=desired_generation) then t else first_dirty_at end,
   last_dirty_at=t,attempts=case when state='running' then attempts else 0 end,
   state=case when state in ('running','parked') then state else 'pending' end,last_error=case when state='parked' then last_error else null end,
   next_eligible_at=greatest(case when state='parked' then next_eligible_at else '-infinity'::timestamptz end,
    public.note_ai_next_eligible(j.id,_pipeline,
     case when state in ('completed','failed') or (state='running' and captured_generation=desired_generation) then t else first_dirty_at end,
     t,last_automatic_start))
  where id=j.id returning * into j;
 end if;
 -- Eligibility can return (for example restoring trash) without a changed body.
 if j.state='failed' and j.last_error='ineligible' then
  update public.note_ai_jobs set state='pending',last_error=null,priority=false,first_dirty_at=t,last_dirty_at=t,
   next_eligible_at=public.note_ai_next_eligible(j.id,_pipeline,t,t,last_automatic_start)
  where id=j.id returning * into j;
 end if;
 -- Manual can wake a cheap parked balance probe, not reset failures or bypass a lease.
 if _reason='manual' and (j.state in ('pending','parked') or (j.state='running' and j.desired_generation>j.captured_generation)) and not j.priority then
  update public.note_ai_jobs set priority=true,next_eligible_at=t,state=case when state='parked' then 'pending' else state end where id=j.id returning * into j;
 end if;
 return to_jsonb(j);
end $$;

create or replace function public.finish_note_ai_job(_user_id uuid,_job_id uuid,_lease_id uuid) returns boolean
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
  next_eligible_at=case when priority and desired_generation>j.captured_generation then clock_timestamp()
   else public.note_ai_next_eligible(j.id,j.pipeline,first_dirty_at,last_dirty_at,last_automatic_start) end
 where id=j.id;
 delete from public.note_ai_completions where job_id=j.id and (completed_at<now()-interval '30 days' or fingerprint in
  (select fingerprint from public.note_ai_completions where job_id=j.id order by completed_at desc offset 20));
 return true;
end $$;

create or replace function public.fail_note_ai_job(_user_id uuid,_job_id uuid,_lease_id uuid,_kind text) returns boolean
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
   public.note_ai_next_eligible(j.id,j.pipeline,first_dirty_at,last_dirty_at,last_automatic_start)) end
 where id=j.id;
 -- A known transient/pre-provider failure allows retry. Uncertain outcomes retain a diagnostic fence.
 if _kind in ('transient','no_credit') then
  delete from public.note_ai_stage_results where job_id=j.id and fingerprint=j.fingerprint and status='started' and lease_id=_lease_id;
 elsif _kind='uncertain' then
  update public.note_ai_stage_results set status='uncertain',updated_at=t where job_id=j.id and fingerprint=j.fingerprint and status='started';
 end if;
 return true;
end $$;

-- Re-key every job with the normalized fingerprint. A job whose body is already
-- canonical keeps its hash; the rest change hash without a generation bump, so
-- the migration itself buys nothing and a pending job is not left unclaimable
-- (claim skips a job whose current fingerprint differs from the desired one).
do $$
declare r record; f text;
begin
 for r in select j.id,j.user_id,j.note_id,j.pipeline,j.desired_fingerprint from public.note_ai_jobs j loop
  f:=public.note_ai_fingerprint(public.note_ai_input(r.user_id,r.note_id,r.pipeline));
  if f is not null and f is distinct from r.desired_fingerprint then
   update public.note_ai_jobs set desired_fingerprint=f where id=r.id;
  end if;
 end loop;
end $$;
