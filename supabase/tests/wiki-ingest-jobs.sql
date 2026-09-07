-- Synthetic fixture, execute in a disposable DB transaction only.
do $$
declare
 u uuid := '70000000-0000-4000-8000-000000000001';
 n uuid := '70000000-0000-4000-8000-000000000002';
 j public.note_ai_jobs; payload jsonb; original jsonb; revisions integer;
begin
 insert into public.notes(id,user_id,title,content) values(n,u,'Wiki fixture','Synthetic Lexicon test input');
 perform public.enqueue_note_ai_job(u,n,'lexicon','manual');
 select * into j from public.claim_note_ai_jobs(10,300,u) where pipeline='lexicon';
 if j.id is null then raise exception 'fixture lease missing'; end if;
 perform public.begin_note_ai_stage(u,j.id,j.lease_id,'wiki-apply');
 payload := jsonb_build_object('actions',jsonb_build_array(jsonb_build_object('op','create','slug','fixture','title','Fixture','content','## Purpose' || chr(10) || 'User protected purpose','expected',null)), 'source_links',jsonb_build_array(jsonb_build_object('note_id',n,'page_slugs',jsonb_build_array('fixture'))));
 perform public.checkpoint_note_ai_stage(u,j.id,j.lease_id,'wiki-apply',payload);
 if public.wiki_apply_note_ai_result('70000000-0000-4000-8000-000000000003',j.id,j.lease_id) then raise exception 'cross tenant apply'; end if;
 if public.wiki_apply_note_ai_result(u,j.id,'70000000-0000-4000-8000-000000000004') then raise exception 'wrong lease apply'; end if;
 update public.note_ai_jobs set lease_expires_at=now()-interval '1 second' where id=j.id;
 if public.wiki_apply_note_ai_result(u,j.id,j.lease_id) then raise exception 'expired lease apply'; end if;
 update public.note_ai_jobs set lease_expires_at=now()+interval '5 minutes' where id=j.id;
 if not public.wiki_apply_note_ai_result(u,j.id,j.lease_id) then raise exception 'valid apply refused'; end if;
 if not public.wiki_apply_note_ai_result(u,j.id,j.lease_id) then raise exception 'replay refused'; end if;
 select count(*) into revisions from public.wiki_revisions where user_id=u;
 if revisions<>1 then raise exception 'replay duplicated revision'; end if;
 if (select count(*) from public.wiki_page_sources where user_id=u)<>1 then raise exception 'missing source'; end if;
 perform public.finish_note_ai_job(u,j.id,j.lease_id);
 perform public.enqueue_note_ai_job(u,n,'lexicon','manual');
 if exists(select 1 from public.claim_note_ai_jobs(10,300,u) where pipeline='lexicon') then raise exception 'completed identical input reclaimed'; end if;
 -- New revision, then a page edit while the paid result is in flight.
 update public.notes set content='Synthetic next input' where id=n;
 perform public.enqueue_note_ai_job(u,n,'lexicon','manual');
 select * into j from public.claim_note_ai_jobs(10,300,u) where pipeline='lexicon';
 select jsonb_build_object('id',id,'title',title,'content',content,'summary',summary,'page_type',page_type,'protected_sections',protected_sections,'updated_at',updated_at) into original from public.wiki_pages where user_id=u and slug='fixture';
 perform public.begin_note_ai_stage(u,j.id,j.lease_id,'wiki-apply');
 payload:=jsonb_build_object('actions',jsonb_build_array(jsonb_build_object('op','update','slug','fixture','patch','AI replacement','expected',original)),'source_links','[]'::jsonb);
 perform public.checkpoint_note_ai_stage(u,j.id,j.lease_id,'wiki-apply',payload);
 update public.wiki_pages set content='User newer words',protected_sections=array['purpose'] where user_id=u and slug='fixture';
 begin
  perform public.wiki_apply_note_ai_result(u,j.id,j.lease_id);
  raise exception 'page conflict must refuse apply';
 exception when sqlstate '40001' then null; end;
 if (select content from public.wiki_pages where user_id=u and slug='fixture')<>'User newer words' then raise exception 'new user page overwritten'; end if;
 -- A note edit invalidates the entire generation, even when page baseline matches.
 update public.notes set content='Synthetic edited during synthesis' where id=n;
 if public.wiki_apply_note_ai_result(u,j.id,j.lease_id) then raise exception 'superseded generation applied'; end if;
 -- Source eligibility is checked again at apply time.
 update public.notes set source_app='hub' where id=n;
 if public.wiki_apply_note_ai_result(u,j.id,j.lease_id) then raise exception 'hub source applied'; end if;
end $$;


-- Zero actions are a completed fingerprint, not a paid retry condition.
do $$
declare u uuid:='72000000-0000-4000-8000-000000000001'; n uuid:='72000000-0000-4000-8000-000000000002'; j public.note_ai_jobs;
begin
 insert into public.notes(id,user_id,title,content) values(n,u,'Zero fixture','Synthetic zero-action input');
 perform public.enqueue_note_ai_job(u,n,'lexicon','manual');
 select * into j from public.claim_note_ai_jobs(10,300,u) where pipeline='lexicon';
 perform public.begin_note_ai_stage(u,j.id,j.lease_id,'wiki-apply');
 perform public.checkpoint_note_ai_stage(u,j.id,j.lease_id,'wiki-apply','{"actions":[],"source_links":[]}'::jsonb);
 perform set_config('request.jwt.claim.role','authenticated',true);
 begin
  perform public.wiki_apply_note_ai_result(u,j.id,j.lease_id);
  raise exception 'ordinary user reached service apply';
 exception when insufficient_privilege then null; end;
 perform set_config('request.jwt.claim.role','service_role',true);
 if not public.wiki_apply_note_ai_result(u,j.id,j.lease_id) then raise exception 'zero actions not applied'; end if;
 perform public.finish_note_ai_job(u,j.id,j.lease_id);
 perform public.enqueue_note_ai_job(u,n,'lexicon','manual');
 if exists(select 1 from public.claim_note_ai_jobs(10,300,u) where pipeline='lexicon') then raise exception 'zero actions repurchased'; end if;
 if exists(select 1 from public.wiki_pages where user_id=u) then raise exception 'zero actions created pages'; end if;
end $$;
