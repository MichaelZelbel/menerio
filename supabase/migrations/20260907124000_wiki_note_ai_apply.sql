-- Service-only Lexicon apply. The paid result, page effects, and replay marker
-- share one transaction. No auth.uid impersonation and no user JWT storage.
create or replace function public.wiki_apply_note_ai_result(_user_id uuid,_job_id uuid,_lease_id uuid)
returns boolean language plpgsql security definer set search_path=public,pg_temp as $$
declare
 j public.note_ai_jobs; s public.note_ai_stage_results; p public.wiki_pages;
 a jsonb; link jsonb; expected jsonb; v_slug text; next_content text;
 page_id uuid; page_title text; previous_content text; created boolean;
 affected uuid[] := '{}';
begin
 if coalesce(auth.role(),'') <> 'service_role' then raise exception 'service only' using errcode='42501'; end if;
 -- Match note-write trigger lock order. A committed newer note cannot race apply.
 perform 1 from public.notes n join public.note_ai_jobs q on q.note_id=n.id and q.user_id=n.user_id
 where q.id=_job_id and q.user_id=_user_id for update of n;
 if not found then return false; end if;
 select * into j from public.note_ai_jobs where id=_job_id and user_id=_user_id for update;
 if not found or j.pipeline<>'lexicon' or j.lease_id is distinct from _lease_id
  or j.state<>'running' or j.lease_expires_at<=clock_timestamp()
  or j.captured_generation is distinct from j.desired_generation
  or public.get_note_ai_job_snapshot(_user_id,_job_id,_lease_id) is null then return false; end if;
 select * into s from public.note_ai_stage_results
 where job_id=j.id and fingerprint=j.fingerprint and stage='wiki-apply' for update;
 if not found then return false; end if;
 if s.status='applied' then return true; end if;
 if s.status<>'checkpointed' then return false; end if;
 if jsonb_typeof(s.result->'actions') is distinct from 'array'
  or jsonb_typeof(s.result->'source_links') is distinct from 'array' then
  raise exception 'invalid Lexicon checkpoint' using errcode='22023';
 end if;
 -- Acquire every target lock in deterministic order, then compare every baseline.
 -- A new protected section, manual title edit, or even a same-text newer revision
 -- refuses the whole batch; no old output is rebased onto a fresh user page.
 for a in select value from jsonb_array_elements(s.result->'actions') order by value->>'slug' loop
  v_slug:=a->>'slug'; expected:=a->'expected';
  if v_slug is null or v_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$' then raise exception 'invalid slug' using errcode='22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended(_user_id::text || ':' || v_slug,0));
  select * into p from public.wiki_pages where user_id=_user_id and wiki_pages.slug=v_slug for update;
  if not found then
   if expected is distinct from 'null'::jsonb or a->>'op'<>'create' then
    raise exception 'Lexicon page changed' using errcode='40001';
   end if;
  else
   if expected is null or expected='null'::jsonb or
    jsonb_build_object('id',p.id,'title',p.title,'content',p.content,'summary',p.summary,
      'page_type',p.page_type,'protected_sections',p.protected_sections,'updated_at',p.updated_at)
    is distinct from jsonb_build_object('id',expected->'id','title',expected->'title','content',expected->'content',
      'summary',expected->'summary','page_type',expected->'page_type','protected_sections',expected->'protected_sections','updated_at',expected->'updated_at') then
    raise exception 'Lexicon page changed' using errcode='40001';
   end if;
  end if;
 end loop;
 if j.lease_expires_at<=clock_timestamp() then return false; end if;
 for a in select value from jsonb_array_elements(s.result->'actions') order by value->>'slug' loop
  v_slug:=a->>'slug';
  select * into p from public.wiki_pages where user_id=_user_id and wiki_pages.slug=v_slug;
  created:=not found; previous_content:=case when created then null else p.content end;
  next_content:=coalesce(a->>'patch',a->>'content','');
  if created then
   insert into public.wiki_pages(user_id,slug,title,page_type,summary,content,last_synthesized_at)
   values(_user_id,v_slug,coalesce(nullif(a->>'title',''),v_slug),coalesce(nullif(a->>'page_type',''),'concept'),nullif(a->>'summary',''),next_content,clock_timestamp())
   returning id,title into page_id,page_title;
  else
   update public.wiki_pages set title=coalesce(nullif(a->>'title',''),title),
    page_type=coalesce(nullif(a->>'page_type',''),page_type),summary=coalesce(nullif(a->>'summary',''),summary),
    content=next_content,last_synthesized_at=clock_timestamp(),updated_at=clock_timestamp()
   where id=p.id and user_id=_user_id returning id,title into page_id,page_title;
  end if;
  insert into public.wiki_revisions(user_id,wiki_page_id,page_slug,page_title,change_type,previous_content,new_content,source_note_id,change_summary,status)
  values(_user_id,page_id,v_slug,page_title,case when created then 'created' else 'updated' end,previous_content,next_content,j.note_id,coalesce(nullif(a->>'change_summary',''),'Synthesized from note'),'applied');
  affected:=array_append(affected,page_id);
  -- Equivalent to wiki_resync_links, but scoped service execution cannot use that
  -- legacy function's auth.uid check. Resolve links only inside this account.
  delete from public.wiki_links where user_id=_user_id and source_page_id=page_id;
  insert into public.wiki_links(user_id,source_page_id,target_slug,target_page_id)
  select distinct _user_id,page_id,m.parts[1],target.id
  from regexp_matches(next_content,'\[\[([a-z0-9-]+)\]\]','g') as m(parts)
  left join public.wiki_pages target on target.user_id=_user_id and target.slug=m.parts[1];
 end loop;
 for link in select value from jsonb_array_elements(s.result->'source_links') loop
  if link->>'note_id' is distinct from j.note_id::text then continue; end if;
  for v_slug in select jsonb_array_elements_text(link->'page_slugs') loop
   select id into page_id from public.wiki_pages where user_id=_user_id and wiki_pages.slug=v_slug;
   if page_id is not null then
    insert into public.wiki_page_sources(user_id,wiki_page_id,note_id) values(_user_id,page_id,j.note_id)
    on conflict(wiki_page_id,note_id) do nothing;
    affected:=array_append(affected,page_id);
   end if;
  end loop;
 end loop;
 update public.wiki_pages wp set source_count=(select count(*) from public.wiki_page_sources ps where ps.user_id=_user_id and ps.wiki_page_id=wp.id)
 where wp.user_id=_user_id and wp.id=any(affected);
 update public.note_ai_stage_results set status='applied',result=null,updated_at=clock_timestamp()
 where job_id=j.id and fingerprint=j.fingerprint and stage='wiki-apply';
 return true;
end $$;
revoke all on function public.wiki_apply_note_ai_result(uuid,uuid,uuid) from public,authenticated;
grant execute on function public.wiki_apply_note_ai_result(uuid,uuid,uuid) to service_role;
