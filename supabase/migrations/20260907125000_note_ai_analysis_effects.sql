-- Service-only analysis effects. Same lock order as note updates: note, then queue job.
create function public.apply_note_ai_output(
 _user_id uuid,_job_id uuid,_lease_id uuid,_metadata jsonb default '{}',
 _embedding jsonb default null,_title text default null,_processed_hash text default null,_finish boolean default false
) returns boolean language plpgsql security definer set search_path=public,extensions,pg_temp as $$
declare j public.note_ai_jobs; n public.notes; renamed boolean:=false; new_fingerprint text;
begin
 if coalesce(auth.role(),'')<>'service_role' then raise exception 'service only' using errcode='42501'; end if;
 select * into n from public.notes where id=(select note_id from public.note_ai_jobs where id=_job_id and user_id=_user_id) and user_id=_user_id for update;
 if not found then return false; end if;
 select * into j from public.note_ai_jobs where id=_job_id and user_id=_user_id for update;
 if not found or j.pipeline<>'analysis' or public.get_note_ai_job_snapshot(_user_id,_job_id,_lease_id) is null or j.captured_generation<>j.desired_generation then return false; end if;
 if jsonb_typeof(coalesce(_metadata,'{}'))<>'object' then raise exception 'invalid metadata' using errcode='22023'; end if;
 renamed:=_finish and nullif(trim(_title),'') is not null and coalesce((n.metadata->>'is_quick_capture')::boolean,false)
  and n.title is not distinct from j.snapshot->>'title' and n.content is not distinct from j.snapshot->>'content' and n.title is distinct from trim(_title);
 update public.notes set
  metadata=coalesce(metadata,'{}'::jsonb) || (coalesce(_metadata,'{}'::jsonb)-array['source','web_clip','is_quick_capture','source_app','is_external','ai_visibility','source_url','import_id']),
  embedding=case when _embedding is null then embedding else (jsonb_populate_record(null::public.notes,jsonb_build_object('embedding',_embedding))).embedding end,
  title=case when renamed then trim(_title) else title end,
  processing_status=case when _finish then 'processed' else 'processing' end,
  processing_error=null,
  processed_at=case when _finish then clock_timestamp() else processed_at end,
  processed_hash=case when _finish then _processed_hash else processed_hash end,
  processing_attempts=case when _finish then 0 else processing_attempts end
 where id=n.id and user_id=_user_id;
 if _finish then
  if not public.finish_note_ai_job(_user_id,_job_id,_lease_id) then raise exception 'lease expired during completion' using errcode='40001'; end if;
  if renamed then
   -- The note lock excludes user edits. Only our derived title changed: its new
   -- input is equivalent completed analysis, not a reason to buy analysis again.
   -- The ordinary trigger still enrolls the new title for an enabled Lexicon job.
   select desired_fingerprint into new_fingerprint from public.note_ai_jobs where id=j.id;
   insert into public.note_ai_completions(job_id,fingerprint,generation)
    select id,new_fingerprint,desired_generation from public.note_ai_jobs where id=j.id
    on conflict(job_id,fingerprint) do nothing;
   update public.note_ai_jobs set state='completed',attempts=0,priority=false,last_error=null where id=j.id;
  end if;
 end if;
 return true;
end $$;

create function public.replace_note_ai_chunks(_user_id uuid,_job_id uuid,_lease_id uuid,_chunks jsonb)
returns boolean language plpgsql security definer set search_path=public,extensions,pg_temp as $$
declare j public.note_ai_jobs; nid uuid;
begin
 if coalesce(auth.role(),'')<>'service_role' then raise exception 'service only' using errcode='42501'; end if;
 select id into nid from public.notes where id=(select note_id from public.note_ai_jobs where id=_job_id and user_id=_user_id) and user_id=_user_id for update;
 if not found then return false; end if;
 select * into j from public.note_ai_jobs where id=_job_id and user_id=_user_id for update;
 if not found or j.pipeline<>'analysis' or public.get_note_ai_job_snapshot(_user_id,_job_id,_lease_id) is null or j.captured_generation<>j.desired_generation then return false; end if;
 if jsonb_typeof(_chunks)<>'array' or jsonb_array_length(_chunks)>50 then raise exception 'invalid chunks' using errcode='22023'; end if;
 if exists(select 1 from jsonb_array_elements(_chunks) r where r->>'user_id' is distinct from _user_id::text or r->>'note_id' is distinct from nid::text) then raise exception 'chunk owner mismatch' using errcode='42501'; end if;
 delete from public.note_chunks where note_id=nid and user_id=_user_id;
 insert into public.note_chunks(note_id,user_id,chunk_index,heading_path,content,token_count,embedding,content_hash)
 select nid,_user_id,chunk_index,heading_path,content,token_count,embedding,content_hash from jsonb_populate_recordset(null::public.note_chunks,_chunks);
 return true;
end $$;
revoke all on function public.apply_note_ai_output(uuid,uuid,uuid,jsonb,jsonb,text,text,boolean),public.replace_note_ai_chunks(uuid,uuid,uuid,jsonb) from public,authenticated;
grant execute on function public.apply_note_ai_output(uuid,uuid,uuid,jsonb,jsonb,text,text,boolean),public.replace_note_ai_chunks(uuid,uuid,uuid,jsonb) to service_role;
