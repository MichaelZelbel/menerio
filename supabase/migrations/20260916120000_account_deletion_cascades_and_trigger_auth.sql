-- Account deletion, made to actually delete the account. Four repairs found
-- by the 2026-09-16 audit (docs/AUDIT_2026-09-16.md), in the order they must
-- land: the trigger fix first, or the cascades added below would trip it.
--
-- 1. enqueue_note_ai_job() refused any session that was neither service_role
--    nor the note's owner. A session with NO JWT at all (GoTrue's admin
--    deleteUser, a migration, the SQL editor, pg_cron) has auth.role() NULL and
--    auth.uid() NULL, so the media_analysis trigger raised 'not authorized'
--    inside the delete cascade and the whole account deletion rolled back:
--    delete-my-account answered 500 for every user with a completed media
--    analysis. The same check made any UPDATE of notes from the SQL editor
--    fail. A session without a JWT can only be the database itself; it is
--    trusted. Sessions that carry a JWT are checked exactly as before.
--
-- 2. world_preferred_survives_delete() vetoed every delete of a hand-typed
--    ('preferred') profile entry or relationship when auth.uid() was NULL,
--    which is precisely the context a referential cascade runs in. Postgres
--    does not re-check the cascade afterwards, so a merged contact left its
--    preferred relationships pointing at a contact that no longer existed, and
--    a deleted account would have left its date of birth, address and health
--    facts behind with a user_id pointing nowhere. A row whose parent is gone
--    now goes with it; a machine tidy-up of a row whose parent still exists is
--    still refused.
--
-- 3. About fifty-five public tables with a user_id column had no foreign key
--    to auth.users, so deleting the auth user deleted the profile and the
--    notes and left contacts, moments, claims, interactions, API keys and MCP
--    tokens in place; a hub key of a deleted account stayed is_active and kept
--    reading its orphaned contacts. Every public table with a uuid user_id
--    column now cascades from auth.users. The list is derived from the
--    catalogue rather than written out, so a table added later is covered by
--    re-running the same block. Each constraint is added NOT VALID and then
--    validated; an orphan row already present stops the migration with the
--    table named, instead of being deleted quietly.
--
-- 4. profile_fields let any account insert a row with is_system = true, and
--    the "structured category" trigger looked such rows up without a user
--    filter, so one account could divert every other account's AI-extracted
--    entries in that category into the review queue. System rows are global
--    (user_id IS NULL) by definition; the CHECK says so.

-- 1. TRIGGER AUTH ------------------------------------------------------------

create or replace function public.enqueue_note_ai_job(_user_id uuid,_note_id uuid,_pipeline text,_reason text default 'automatic') returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare s jsonb; f text; j public.note_ai_jobs; t timestamptz:=clock_timestamp();
begin
 -- A session with no JWT (auth.role() null) is the database itself: a cascade,
 -- a migration, pg_cron. Only a session that presents a role is checked.
 if auth.role() is not null and auth.role() <> 'service_role' and auth.uid() is distinct from _user_id then raise exception 'not authorized' using errcode='42501'; end if;
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

-- A media row deleted because its note is going has nothing to re-queue.
create or replace function public.note_ai_media_changed() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if TG_OP='DELETE' and not exists (select 1 from public.notes where id=old.note_id) then return old; end if;
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

-- 2. PREFERRED ROWS FOLLOW THEIR PARENT ---------------------------------------

CREATE OR REPLACE FUNCTION public.world_preferred_survives_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL AND OLD.rank = 'preferred' THEN
    -- No JWT at all: the database itself (a cascade from auth.users or from
    -- contacts, a migration). Never veto that.
    IF auth.role() IS NULL THEN
      RETURN OLD;
    END IF;
    -- A service-role session whose parent contact is already gone is a cascade
    -- too; keeping the row would leave it pointing at nothing.
    IF TG_TABLE_NAME = 'profile_entries' AND OLD.contact_id IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM public.contacts WHERE id = OLD.contact_id) THEN
      RETURN OLD;
    END IF;
    IF TG_TABLE_NAME = 'contact_relationships'
       AND (NOT EXISTS (SELECT 1 FROM public.contacts WHERE id = OLD.source_id)
         OR NOT EXISTS (SELECT 1 FROM public.contacts WHERE id = OLD.target_id)) THEN
      RETURN OLD;
    END IF;
    -- A machine deleting a hand-edited row whose parent still exists is
    -- cancelled outright, as before.
    RETURN NULL;
  END IF;
  RETURN OLD;
END;
$$;

-- 3. EVERY USER-OWNED TABLE CASCADES FROM auth.users ---------------------------

DO $$
DECLARE
  r record;
  fk_name text;
  orphans bigint;
BEGIN
  FOR r IN
    SELECT c.table_name
    FROM information_schema.columns c
    JOIN information_schema.tables t
      ON t.table_schema = c.table_schema AND t.table_name = c.table_name AND t.table_type = 'BASE TABLE'
    WHERE c.table_schema = 'public'
      AND c.column_name = 'user_id'
      AND c.data_type = 'uuid'
      AND NOT EXISTS (
        SELECT 1
        FROM pg_constraint k
        JOIN pg_class cl ON cl.oid = k.conrelid
        JOIN pg_namespace ns ON ns.oid = cl.relnamespace
        JOIN pg_attribute a ON a.attrelid = k.conrelid AND a.attnum = ANY (k.conkey)
        WHERE k.contype = 'f'
          AND ns.nspname = 'public'
          AND cl.relname = c.table_name
          AND a.attname = 'user_id'
          AND k.confrelid = 'auth.users'::regclass
      )
    ORDER BY c.table_name
  LOOP
    fk_name := r.table_name || '_user_id_auth_users_fkey';

    EXECUTE format(
      'SELECT count(*) FROM public.%I x WHERE x.user_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = x.user_id)',
      r.table_name
    ) INTO orphans;
    IF orphans > 0 THEN
      RAISE EXCEPTION 'public.% holds % row(s) whose user_id matches no auth user. Decide what to do with them (archive or delete), then re-run this migration.',
        r.table_name, orphans;
    END IF;

    -- The cascade deletes by user_id; without an index that is a full scan of
    -- every table for every deleted account.
    IF NOT EXISTS (
      SELECT 1
      FROM pg_index i
      JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = i.indkey[0]
      WHERE i.indrelid = format('public.%I', r.table_name)::regclass
        AND a.attname = 'user_id'
    ) THEN
      EXECUTE format('CREATE INDEX %I ON public.%I (user_id)', r.table_name || '_user_id_idx', r.table_name);
    END IF;

    EXECUTE format(
      'ALTER TABLE public.%I ADD CONSTRAINT %I FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE NOT VALID',
      r.table_name, fk_name
    );
    EXECUTE format('ALTER TABLE public.%I VALIDATE CONSTRAINT %I', r.table_name, fk_name);
    RAISE NOTICE 'account cascade: % now references auth.users', r.table_name;
  END LOOP;
END $$;

-- 4. SYSTEM PROFILE FIELDS ARE GLOBAL ------------------------------------------

ALTER TABLE public.profile_fields
  DROP CONSTRAINT IF EXISTS profile_fields_system_is_global;
ALTER TABLE public.profile_fields
  ADD CONSTRAINT profile_fields_system_is_global CHECK (NOT is_system OR user_id IS NULL);

COMMENT ON CONSTRAINT profile_fields_system_is_global ON public.profile_fields IS
  'A system field applies to every account, so it has no owner. Added 2026-09-16: without it any account could insert a system row and divert other accounts'' entries for that category into review.';
