begin;
set local role authenticated;
set local request.jwt.claim.role = 'authenticated';
set local request.jwt.claim.sub = '81000000-0000-4000-8000-000000000001';
do $$ declare n jsonb; begin
 n := public.capture_note_with_lexicon('{"id":"81000000-0000-4000-8000-000000000002","title":""}'::jsonb);
 assert n->>'content' = '', 'empty capture must retain database defaults';
 assert n->>'folder_path' = '', 'folder default';
 assert (select count(*) from public.note_ai_jobs where note_id=(n->>'id')::uuid and pipeline='lexicon') = 1, 'save must commit subscription';
end $$;
-- Replay only reads the latest body and does not reset scheduling.
do $$ declare before_job jsonb; after_job jsonb; n jsonb; begin
 update public.notes set content='newer revision' where id='81000000-0000-4000-8000-000000000002';
 select to_jsonb(j) into before_job from public.note_ai_jobs j where note_id='81000000-0000-4000-8000-000000000002' and pipeline='lexicon';
 n := public.capture_note_with_lexicon('{"id":"81000000-0000-4000-8000-000000000002","content":"old capture"}');
 assert n->>'content'='newer revision', 'replayed PUT must not overwrite newer content';
 select to_jsonb(j) into after_job from public.note_ai_jobs j where note_id='81000000-0000-4000-8000-000000000002' and pipeline='lexicon';
 assert before_job=after_job, 'replay must preserve queue timers and generation';
end $$;
-- A lost response followed by remote hard deletion must not resurrect old data.
do $$ declare n jsonb; begin
 n := public.capture_note_with_lexicon('{"id":"81000000-0000-4000-8000-000000000005","content":"deleted capture"}');
 delete from public.notes where id='81000000-0000-4000-8000-000000000005';
 n := public.capture_note_with_lexicon('{"id":"81000000-0000-4000-8000-000000000005","content":"deleted capture"}');
 assert n is null, 'deleted capture replay must return no note';
 assert not exists(select 1 from public.notes where id='81000000-0000-4000-8000-000000000005'), 'replay resurrected deleted note';
end $$;
-- Ordinary historical inserts and edits do not enroll; RPC collision cannot backfill.
insert into public.notes(id,content) values('81000000-0000-4000-8000-000000000003','historical fixture');
update public.notes set title='edited' where id='81000000-0000-4000-8000-000000000003';
select public.capture_note_with_lexicon('{"id":"81000000-0000-4000-8000-000000000003"}');
do $$ begin
 assert not exists(select 1 from public.note_ai_jobs where note_id='81000000-0000-4000-8000-000000000003' and pipeline='lexicon'), 'no historical subscription';
end $$;
-- Eligible offline payload keeps JSON, flags, nulls, timestamps and defaults.
do $$ declare n jsonb; begin
 n := public.capture_note_with_lexicon('{"title":"offline","tags":["fixture"],"metadata":{"test":true},"is_favorite":true,"created_at":"2026-09-07T00:00:00Z","related":[],"structured_fields":{},"trashed_at":null}');
 assert n->'tags'='["fixture"]'::jsonb and n->'metadata'='{"test":true}'::jsonb;
 assert (n->>'is_favorite')::boolean and n->>'sync_status'='synced';
 assert (n->>'created_at')::timestamptz='2026-09-07T00:00:00Z'::timestamptz;
end $$;
-- Server scope cannot be bypassed by calling RPC directly.
do $$ declare fields jsonb; n jsonb; begin
 for fields in select * from jsonb_array_elements('[{"source_app":"hub"},{"source_app":"import"},{"is_external":true},{"ai_visibility":"hidden"},{"is_trashed":true}]') loop
  n := public.capture_note_with_lexicon(fields);
  assert not exists(select 1 from public.note_ai_jobs where note_id=(n->>'id')::uuid and pipeline='lexicon'), 'excluded source enrolled';
 end loop;
 begin
  perform public.capture_note_with_lexicon('{"user_id":"82000000-0000-4000-8000-000000000001"}');
  raise exception 'owner spoof accepted';
 exception when insufficient_privilege then null; end;
 begin
  perform public.capture_note_with_lexicon('{"processed_hash":"spoofed"}');
  raise exception 'server column accepted';
 exception when invalid_parameter_value then null; end;
end $$;
set local request.jwt.claim.sub = '82000000-0000-4000-8000-000000000001';
do $$ begin
 begin
  perform public.capture_note_with_lexicon('{"id":"81000000-0000-4000-8000-000000000002","content":"cross-account overwrite"}');
  raise exception 'cross-account capture accepted';
 exception when insufficient_privilege then null; end;
end $$;
set local request.jwt.claim.sub = '';
do $$ begin
 begin
  perform public.capture_note_with_lexicon('{}');
  raise exception 'anonymous capture accepted';
 exception when insufficient_privilege then null; end;
end $$;
reset role;
do $$ begin
 assert not has_function_privilege('anon','public.capture_note_with_lexicon(jsonb)','execute');
 assert not has_function_privilege('service_role','public.capture_note_with_lexicon(jsonb)','execute');
 assert not has_table_privilege('authenticated','public.note_capture_receipts','delete');
 assert not has_table_privilege('authenticated','public.note_capture_receipts','update');
 assert (select prosecdef=false from pg_proc where oid='public.capture_note_with_lexicon(jsonb)'::regprocedure), 'capture must use existing note RLS';
end $$;
-- Force a Lexicon-only insert failure: no confirmed note may survive without enrollment.
create function public.enrollment_test_reject() returns trigger language plpgsql as $$ begin
 if new.pipeline='lexicon' then raise exception 'synthetic queue outage' using errcode='23514'; end if;
 return new;
end $$;
create trigger enrollment_test_reject before insert on public.note_ai_jobs for each row execute function public.enrollment_test_reject();
set local role authenticated;
set local request.jwt.claim.sub = '81000000-0000-4000-8000-000000000001';
do $$ begin
 begin
  perform public.capture_note_with_lexicon('{"id":"81000000-0000-4000-8000-000000000004","title":"rollback fixture"}');
  raise exception 'queue failure swallowed';
 exception when serialization_failure then null; end;
 assert not exists(select 1 from public.notes where id='81000000-0000-4000-8000-000000000004'), 'failed enrollment must roll back capture';
 assert not exists(select 1 from public.note_ai_jobs where note_id='81000000-0000-4000-8000-000000000004'), 'analysis trigger also rolls back';
 assert not exists(select 1 from public.note_capture_receipts where note_id='81000000-0000-4000-8000-000000000004'), 'receipt must roll back so next upload can insert';
end $$;
rollback;
