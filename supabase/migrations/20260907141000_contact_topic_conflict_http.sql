-- Business conflicts must return HTTP 409, not the retryable serialization SQLSTATE.
-- Hosted PostgREST may retry 40001 indefinitely; stale versions cannot succeed on retry.
create or replace function public.apply_contact_topic_command_internal(p_user_id uuid,p_request_id uuid,p_command jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
 t public.contact_topics; old_state jsonb; e public.contact_topic_events; reversed public.contact_topic_events;
 act text; keys text[]; patch jsonb; event_time timestamptz := clock_timestamp(); event_id uuid := gen_random_uuid();
begin
 if p_user_id is null then raise exception 'Authentication required' using errcode='42501'; end if;
 if p_request_id is null or jsonb_typeof(p_command) is distinct from 'object' then raise exception 'Invalid command' using errcode='22023'; end if;
 perform pg_advisory_xact_lock_shared(hashtextextended('contact-topics-lifecycle',0));
 perform pg_advisory_xact_lock(hashtextextended('contact-topics:'||p_user_id::text,0));
 select * into e from public.contact_topic_events where user_id=p_user_id and request_id=p_request_id;
 if found then
   if e.request_hash <> encode(sha256(convert_to(p_command::text,'UTF8')),'hex') then raise exception 'Request ID already used for a different command' using errcode='22023'; end if;
   return jsonb_build_object('topic',e.after_state,'event_id',e.id,'replayed',true);
 end if;
 act := p_command->>'action';
 keys := case act
 when 'create' then array['action','contact_id','title','mode','priority']
 when 'update' then array['action','topic_id','expected_version','patch']
 when 'discuss' then array['action','topic_id','expected_version','discussed_at','close_after']
 when 'archive' then array['action','topic_id','expected_version']
 when 'reopen' then array['action','topic_id','expected_version']
 when 'undo' then array['action','topic_id','expected_version','event_id'] end;
 if keys is null or exists(select 1 from jsonb_object_keys(p_command) k where not(k=any(keys))) then raise exception 'Unsupported command keys or action' using errcode='22023'; end if;
 if act='create' then
   if jsonb_typeof(p_command->'title') is distinct from 'string' then raise exception 'Title must be a string' using errcode='22023'; end if;
   if (p_command ? 'mode' and jsonb_typeof(p_command->'mode')<>'string') or (p_command ? 'priority' and jsonb_typeof(p_command->'priority')<>'string') then raise exception 'Mode and priority must be strings' using errcode='22023'; end if;
   t.id := gen_random_uuid(); t.user_id:=p_user_id; t.contact_id:=(p_command->>'contact_id')::uuid;
   t.title:=btrim(p_command->>'title'); t.mode:=coalesce(p_command->>'mode','one_off'); t.priority:=coalesce(p_command->>'priority','normal');
   t.status:='active'; t.version:=1; t.created_at:=event_time; t.updated_at:=event_time;
 else
   select * into t from public.contact_topics where id=(p_command->>'topic_id')::uuid and user_id=p_user_id for update;
   if not found then raise exception 'Topic not found' using errcode='42501'; end if;
   if jsonb_typeof(p_command->'expected_version') is distinct from 'number' or (p_command->>'expected_version') !~ '^[1-9][0-9]*$' then raise exception 'Expected version required' using errcode='22023'; end if;
   if t.version<>(p_command->>'expected_version')::integer then raise exception 'Topic version conflict' using errcode='PT409',detail=jsonb_build_object('current_version',t.version)::text; end if;
   old_state:=to_jsonb(t); t.version:=t.version+1; t.updated_at:=event_time;
 end if;
 if not exists(select 1 from public.contacts where id=t.contact_id and user_id=p_user_id and merged_into is null and not topic_self_merge_pending) then raise exception 'Person not found or already merged' using errcode='42501'; end if;
 if act='update' then
   patch:=p_command->'patch';
   if jsonb_typeof(patch) is distinct from 'object' or patch='{}'::jsonb then raise exception 'Nonempty patch required' using errcode='22023'; end if;
   if exists(select 1 from jsonb_each(patch) x where x.key not in ('title','mode','priority') or jsonb_typeof(x.value)<>'string') then raise exception 'Invalid patch' using errcode='22023'; end if;
   t.title:=case when patch ? 'title' then btrim(patch->>'title') else t.title end;
   t.mode:=coalesce(patch->>'mode',t.mode); t.priority:=coalesce(patch->>'priority',t.priority);
 elsif act='discuss' then
   if t.status<>'active' then raise exception 'Reopen this topic before recording a discussion' using errcode='22023'; end if;
   if p_command ? 'close_after' and jsonb_typeof(p_command->'close_after')<>'boolean' then raise exception 'close_after must be boolean' using errcode='22023'; end if;
   if p_command ? 'discussed_at' then
     if jsonb_typeof(p_command->'discussed_at')<>'string' or (p_command->>'discussed_at') !~ '(Z|[+-][0-9]{2}:[0-9]{2})$' then raise exception 'Discussion time requires an explicit timezone' using errcode='22023'; end if;
     event_time:=(p_command->>'discussed_at')::timestamptz;
   end if;
   if event_time>clock_timestamp() then raise exception 'Discussion time cannot be in the future' using errcode='22023'; end if;
   t.last_discussed_at:=greatest(t.last_discussed_at,event_time);
   if t.mode='one_off' or coalesce((p_command->>'close_after')::boolean,false) then t.status:='completed'; t.completed_at:=event_time; end if;
 elsif act='archive' then
   if t.status<>'active' then raise exception 'Only active topics can be archived' using errcode='22023'; end if;
   t.status:='archived'; t.archived_at:=event_time;
 elsif act='reopen' then
   if t.status='active' then raise exception 'Topic is already active' using errcode='22023'; end if;
   t.status:='active'; t.completed_at:=null; t.archived_at:=null;
 elsif act='undo' then
   select * into reversed from public.contact_topic_events where id=(p_command->>'event_id')::uuid and user_id=p_user_id and topic_id=t.id;
   if not found or reversed.action in ('undo','reassign') or (reversed.after_state->>'version')::integer<>t.version-1
      or exists(select 1 from public.contact_topic_events where reverses_event_id=reversed.id) then raise exception 'Only the latest unreversed change can be undone' using errcode='PT409'; end if;
   if reversed.action='create' then t.status:='archived'; t.archived_at:=event_time;
   else
     t.title:=reversed.before_state->>'title'; t.mode:=reversed.before_state->>'mode'; t.priority:=reversed.before_state->>'priority';
     t.status:=reversed.before_state->>'status'; t.completed_at:=(reversed.before_state->>'completed_at')::timestamptz;
     t.archived_at:=(reversed.before_state->>'archived_at')::timestamptz;
   end if;
   select max(d.happened_at) into t.last_discussed_at from public.contact_topic_events d
    where d.topic_id=t.id and d.action='discuss' and d.id<>reversed.id
    and not exists(select 1 from public.contact_topic_events u where u.reverses_event_id=d.id);
 end if;
 if act='create' then insert into public.contact_topics select t.*;
 else update public.contact_topics set title=t.title,mode=t.mode,priority=t.priority,status=t.status,version=t.version,
 last_discussed_at=t.last_discussed_at,completed_at=t.completed_at,archived_at=t.archived_at,updated_at=t.updated_at where id=t.id; end if;
 insert into public.contact_topic_events(id,user_id,topic_id,request_id,action,request_hash,before_state,after_state,happened_at,reverses_event_id)
 values(event_id,p_user_id,t.id,p_request_id,act,encode(sha256(convert_to(p_command::text,'UTF8')),'hex'),old_state,to_jsonb(t),event_time,reversed.id);
 return jsonb_build_object('topic',to_jsonb(t),'event_id',event_id,'replayed',false);
end $$;
