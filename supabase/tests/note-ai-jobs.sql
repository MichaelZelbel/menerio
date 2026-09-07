-- Real PostgreSQL assertions; synthetic notes only, rolled back after each suite.
begin;
insert into public.notes(id,user_id,title,content) values
 ('00000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','Synthetic note','Three synthetic test words');
do $$ declare j jsonb; before_row jsonb; after_row jsonb;
begin
 j := public.enqueue_note_ai_job('10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001','analysis','automatic');
 if j->>'state' <> 'pending' then raise exception 'new job must be pending'; end if;
 before_row := j;
 j := public.enqueue_note_ai_job('10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001','analysis','automatic');
 if j <> before_row then raise exception 'unchanged enqueue must be stable'; end if;
 update public.notes set content=content where id='00000000-0000-0000-0000-000000000001';
 select to_jsonb(q) into after_row from public.note_ai_jobs q where id=(j->>'id')::uuid;
 if after_row <> before_row then raise exception 'same-value write changed generation/timing'; end if;
 update public.notes set created_at=created_at+interval '1 day' where id='00000000-0000-0000-0000-000000000001';
 after_row:=public.enqueue_note_ai_job('10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001','analysis','automatic');
 if after_row<>before_row then raise exception 'timestamp became an input version'; end if;
 if exists(select 1 from public.note_ai_jobs where pipeline='lexicon') then raise exception 'trigger broadened Lexicon enrollment'; end if;
end $$;
rollback;

begin;
insert into public.notes(id,user_id,title,content) values
 ('00000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000002','Stage fixture','Synthetic stage retry content');
select public.enqueue_note_ai_job('10000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000002','analysis','manual');
do $$ declare j public.note_ai_jobs; r jsonb; old_lease uuid;
begin
 select * into j from public.claim_note_ai_jobs(1,300,'10000000-0000-0000-0000-000000000002');
 r:=public.begin_note_ai_stage(j.user_id,j.id,j.lease_id,'metadata');
 if r->>'status'<>'started' then raise exception 'stage must begin durably'; end if;
 if not public.checkpoint_note_ai_stage(j.user_id,j.id,j.lease_id,'metadata','{"synthetic":true}') then raise exception 'checkpoint failed'; end if;
 if not public.apply_note_ai_stage(j.user_id,j.id,j.lease_id,'metadata') then raise exception 'apply failed'; end if;
 if not public.fail_note_ai_job(j.user_id,j.id,j.lease_id,'transient') then raise exception 'failure release failed'; end if;
 update public.note_ai_jobs set next_eligible_at=now()-interval '1 second' where id=j.id;
 select * into j from public.claim_note_ai_jobs(1,300,j.user_id);
 r:=public.begin_note_ai_stage(j.user_id,j.id,j.lease_id,'metadata');
 if r->>'status'<>'applied' or r->'result'<>'{"synthetic":true}'::jsonb then raise exception 'paid result lost on downstream retry'; end if;
 r:=public.begin_note_ai_stage(j.user_id,j.id,j.lease_id,'profile');
 old_lease:=j.lease_id;
 update public.note_ai_jobs set lease_expires_at=now()-interval '1 second',last_automatic_start=now()-interval '11 minutes' where id=j.id;
 if public.finish_note_ai_job(j.user_id,j.id,old_lease) then raise exception 'expired lease finished'; end if;
 select * into j from public.claim_note_ai_jobs(1,300,j.user_id);
 r:=public.begin_note_ai_stage(j.user_id,j.id,j.lease_id,'profile');
 if r->>'status'<>'uncertain' then raise exception 'uncertain paid stage was silently retried'; end if;
 if not public.fail_note_ai_job(j.user_id,j.id,j.lease_id,'uncertain') then raise exception 'uncertain release failed'; end if;
 select * into j from public.note_ai_jobs where id=j.id;
 if j.state<>'failed' or j.last_error<>'uncertain' then raise exception 'uncertain must need review'; end if;
 perform public.enqueue_note_ai_job(j.user_id,j.note_id,'analysis','manual');
 if exists(select 1 from public.claim_note_ai_jobs(1,300,j.user_id)) then raise exception 'manual bypassed failure cap'; end if;
 update public.notes set content='New generation resets attempts' where id=j.note_id;
 perform public.enqueue_note_ai_job(j.user_id,j.note_id,'analysis','manual');
 select * into j from public.claim_note_ai_jobs(1,300,j.user_id);
 if j.attempts<>1 then raise exception 'new generation did not reset attempts'; end if;
 perform public.fail_note_ai_job(j.user_id,j.id,j.lease_id,'no_credit');
 if exists(select 1 from public.claim_note_ai_jobs(1,300,j.user_id)) then raise exception 'automatic no-credit parking bypassed'; end if;
 update public.notes set content='Edit while balance remains empty' where id=j.note_id;
 select * into j from public.note_ai_jobs where id=j.id;
 if j.state<>'parked' or j.next_eligible_at<now()+interval '59 minutes' then raise exception 'new edit bypassed account no-credit parking'; end if;
 perform public.enqueue_note_ai_job(j.user_id,j.note_id,'analysis','manual');
 select * into j from public.claim_note_ai_jobs(1,300,j.user_id);
 if j.id is null or j.attempts<>1 then raise exception 'manual did not wake cheap balance probe or reset attempts incorrectly'; end if;
end $$;
rollback;

begin;
insert into public.notes(id,user_id,title,content) values
 ('00000000-0000-0000-0000-000000000003','10000000-0000-0000-0000-000000000003','Media fixture','Synthetic media test content');
do $$ declare j public.note_ai_jobs; old_generation bigint; old_fp text; r jsonb;
begin
 select * into j from public.note_ai_jobs where note_id='00000000-0000-0000-0000-000000000003';
 old_generation:=j.desired_generation; old_fp:=j.desired_fingerprint;
 insert into public.media_analysis(id,user_id,note_id,analysis_status,extracted_text,storage_path,media_type) values
 ('20000000-0000-0000-0000-000000000003',j.user_id,j.note_id,'pending','Synthetic attachment','synthetic/attachment','image');
 select * into j from public.note_ai_jobs where id=j.id;
 if j.desired_generation<>old_generation then raise exception 'pending media dirtied input'; end if;
 update public.media_analysis set analysis_status='complete' where id='20000000-0000-0000-0000-000000000003';
 select * into j from public.note_ai_jobs where id=j.id;
 if j.desired_generation<=old_generation or j.desired_fingerprint=old_fp then raise exception 'completed media did not invalidate input'; end if;
 old_generation:=j.desired_generation;
 update public.media_analysis set extracted_text=extracted_text where id='20000000-0000-0000-0000-000000000003';
 update public.notes set metadata='{"synthetic":"output only"}' where id=j.note_id;
 select * into j from public.note_ai_jobs where id=j.id;
 if j.desired_generation<>old_generation then raise exception 'no-op media or metadata dirtied input'; end if;
 perform public.enqueue_note_ai_job(j.user_id,j.note_id,'lexicon','automatic');
 update public.notes set title='Lexicon subscribed new title' where id=j.note_id;
 if not exists(select 1 from public.note_ai_jobs where note_id=j.note_id and pipeline='lexicon' and desired_generation=2) then raise exception 'Lexicon subscription lost edit'; end if;
 update public.notes set source_app=' HuB ' where id=j.note_id;
 if public.enqueue_note_ai_job(j.user_id,j.note_id,'lexicon','manual') is not null then raise exception 'hub Lexicon accepted'; end if;
 perform public.enqueue_note_ai_job(j.user_id,j.note_id,'analysis','manual');
 select * into j from public.claim_note_ai_jobs(1,300,j.user_id);
 if (j.snapshot->>'extract_facts')::boolean then raise exception 'hub extraction allowed'; end if;
 update public.notes set ai_visibility='hidden' where id=j.note_id;
 if public.get_note_ai_job_snapshot(j.user_id,j.id,j.lease_id) is not null then raise exception 'visibility change did not fence running snapshot'; end if;
 update public.notes set is_trashed=true where id=j.note_id;
 if public.get_note_ai_job_snapshot(j.user_id,j.id,j.lease_id) is not null then raise exception 'trash did not fence snapshot'; end if;
end $$;
rollback;

begin;
insert into public.notes(id,user_id,title,content) values
 ('00000000-0000-0000-0000-000000000004','10000000-0000-0000-0000-000000000004','Owner fixture','Synthetic owner content');
set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000005',true);
do $$ begin
 begin
  perform public.enqueue_note_ai_job('10000000-0000-0000-0000-000000000004','00000000-0000-0000-0000-000000000004','analysis','manual');
  raise exception 'cross-account enqueue allowed';
 exception when insufficient_privilege then null; end;
 begin
  perform public.claim_note_ai_jobs(); raise exception 'owner could claim service jobs';
 exception when insufficient_privilege then null; end;
 if exists(select 1 from public.note_ai_jobs) then raise exception 'RLS exposed another account'; end if;
end $$;
rollback;

begin;
insert into public.notes(id,user_id,title,content) values
 ('00000000-0000-0000-0000-000000000006','10000000-0000-0000-0000-000000000006','Cooldown fixture','Synthetic automatic lease content');
do $$ declare j public.note_ai_jobs; prior text;
begin
 update public.note_ai_jobs set next_eligible_at=now()-interval '1 second' where note_id='00000000-0000-0000-0000-000000000006';
 select * into j from public.claim_note_ai_jobs(1,30,'10000000-0000-0000-0000-000000000006');
 update public.note_ai_jobs set lease_expires_at=now()-interval '1 second' where id=j.id;
 if exists(select 1 from public.claim_note_ai_jobs(1,30,j.user_id)) then raise exception 'expired automatic lease bypassed cooldown'; end if;
end $$;
rollback;

begin;
insert into public.notes(id,user_id,title,content,metadata) values
 ('00000000-0000-0000-0000-000000000007','10000000-0000-0000-0000-000000000007','Priority fixture','Synthetic priority content','{"is_quick_capture":true,"source":"synthetic"}');
do $$ declare j public.note_ai_jobs; r public.note_ai_jobs;
begin
 perform public.enqueue_note_ai_job('10000000-0000-0000-0000-000000000007','00000000-0000-0000-0000-000000000007','analysis','manual');
 select * into j from public.claim_note_ai_jobs(1,300,'10000000-0000-0000-0000-000000000007');
 if j.snapshot->'metadata'->>'source' is distinct from 'synthetic' then raise exception 'snapshot lost original metadata'; end if;
 update public.notes set content='Newer manual requested generation' where id=j.note_id;
 perform public.enqueue_note_ai_job(j.user_id,j.note_id,'analysis','manual');
 perform public.finish_note_ai_job(j.user_id,j.id,j.lease_id);
 select * into r from public.claim_note_ai_jobs(1,300,j.user_id);
 if r.id is null or r.captured_generation<=j.captured_generation then raise exception 'manual priority during run lost'; end if;
end $$;
rollback;

begin;
insert into public.notes(id,user_id,title,content)
 select gen_random_uuid(),'10000000-0000-0000-0000-000000000010','Busy account fixture','Synthetic fairness content' from generate_series(1,12);
insert into public.notes(id,user_id,title,content) values
 ('00000000-0000-0000-0000-000000000011','10000000-0000-0000-0000-000000000011','Quiet account fixture','Synthetic fairness content');
update public.note_ai_jobs set next_eligible_at=now()-interval '5 minutes' where user_id='10000000-0000-0000-0000-000000000010';
update public.note_ai_jobs set next_eligible_at=now()-interval '1 minute' where user_id='10000000-0000-0000-0000-000000000011';
do $$ declare accounts integer;
begin
 select count(distinct user_id) into accounts from public.claim_note_ai_jobs(2,300,null);
 if accounts<>2 then raise exception 'busy account starved another account'; end if;
end $$;
rollback;

begin;
insert into public.notes(id,user_id,title,content) values
 ('00000000-0000-0000-0000-000000000012','10000000-0000-0000-0000-000000000012','Admin fixture','Synthetic deliberate reanalysis content');
do $$ declare j public.note_ai_jobs; r jsonb; old_fp text;
begin
 perform public.enqueue_note_ai_job('10000000-0000-0000-0000-000000000012','00000000-0000-0000-0000-000000000012','analysis','manual');
 select * into j from public.claim_note_ai_jobs(1,300,'10000000-0000-0000-0000-000000000012');
 r:=public.reanalyze_note_ai_job(j.user_id,j.note_id,'analysis');
 if r->>'lease_id'<>j.lease_id::text or (r->>'desired_generation')::bigint<>j.desired_generation then raise exception 'admin bypassed active lease'; end if;
 old_fp:=j.fingerprint;
 perform public.finish_note_ai_job(j.user_id,j.id,j.lease_id);
 perform public.reanalyze_note_ai_job(j.user_id,j.note_id,'analysis');
 select * into j from public.claim_note_ai_jobs(1,300,j.user_id);
 if j.id is null or j.fingerprint=old_fp or j.attempts<>1 then raise exception 'deliberate reanalysis did not get new policy input'; end if;
 if not exists(select 1 from public.note_ai_completions where job_id=j.id and fingerprint=old_fp) then raise exception 'admin erased completed history'; end if;
end $$;
set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000012',true);
do $$ begin
 begin
  perform public.reanalyze_note_ai_job('10000000-0000-0000-0000-000000000012','00000000-0000-0000-0000-000000000012','analysis');
  raise exception 'ordinary owner allowed deliberate reanalysis';
 exception when insufficient_privilege then null; end;
end $$;
rollback;

begin;
insert into public.notes(id,user_id,title,content) values
 ('00000000-0000-0000-0000-000000000013','10000000-0000-0000-0000-000000000013','Retention fixture','Synthetic retention content');
do $$ declare j public.note_ai_jobs; i integer; r jsonb;
begin
 for i in 1..25 loop
  update public.notes set content='Synthetic retained revision '||i where id='00000000-0000-0000-0000-000000000013';
  perform public.enqueue_note_ai_job('10000000-0000-0000-0000-000000000013','00000000-0000-0000-0000-000000000013','analysis','manual');
  select * into j from public.claim_note_ai_jobs(1,300,'10000000-0000-0000-0000-000000000013');
  r:=public.begin_note_ai_stage(j.user_id,j.id,j.lease_id,'fixture');
  perform public.checkpoint_note_ai_stage(j.user_id,j.id,j.lease_id,'fixture','{"synthetic":true}');
  perform public.finish_note_ai_job(j.user_id,j.id,j.lease_id);
 end loop;
 if (select count(*) from public.note_ai_completions where job_id=j.id)<>20 then raise exception 'completion retention is not bounded'; end if;
 if (select count(distinct fingerprint) from public.note_ai_stage_results where job_id=j.id)>20 then raise exception 'stage fingerprint retention is not bounded'; end if;
 if exists(select 1 from public.note_ai_stage_results where job_id=j.id and result is not null) then raise exception 'completed pipeline retained paid result content'; end if;
 if exists(select 1 from public.note_ai_jobs where id=j.id and snapshot is not null) then raise exception 'completed pipeline retained note body snapshot'; end if;
end $$;
rollback;

begin;
insert into public.notes(id,user_id,title,content) values
 ('00000000-0000-0000-0000-000000000014','10000000-0000-0000-0000-000000000014','Restored fixture','Synthetic restored content');
do $$ declare j public.note_ai_jobs;
begin
 perform public.enqueue_note_ai_job('10000000-0000-0000-0000-000000000014','00000000-0000-0000-0000-000000000014','analysis','manual');
 update public.notes set is_trashed=true where id='00000000-0000-0000-0000-000000000014';
 perform public.claim_note_ai_jobs(1,300,'10000000-0000-0000-0000-000000000014');
 update public.notes set is_trashed=false where id='00000000-0000-0000-0000-000000000014';
 perform public.enqueue_note_ai_job('10000000-0000-0000-0000-000000000014','00000000-0000-0000-0000-000000000014','analysis','manual');
 select * into j from public.claim_note_ai_jobs(1,300,'10000000-0000-0000-0000-000000000014');
 if j.id is null then raise exception 'restored eligible note permanently lost queue'; end if;
end $$;
rollback;
