-- Fact store rollback (docs/plans/one-fact-store.md, 5.4). One script, usable at
-- any point in Part B or C: after the schema migration alone, or after the switch.
-- Needs the B1 snapshot (fact_backup.sql) if the switch committed.
--
-- The runner wraps it in one transaction. Then: redeploy the edge function
-- versions recorded in A1 and republish the previous frontend (step 6), outside SQL.
--
-- Order matters (5.4): keep what the restore drops, remove the new guards,
-- restore the data, put the old triggers back after the data, undo the schema.

SET LOCAL menerio.fact_migration = 'on';

-- 1. Keep what the restore will drop, inside the database: every claim created
-- or changed since B1 that the switch did not make. Only its count is shown.
DO $$
BEGIN
  IF to_regclass('public.profile_entries_archive') IS NOT NULL AND to_regclass('fact_backup.claims') IS NULL THEN
    RAISE EXCEPTION 'fact_store_rollback: the switch ran but there is no B1 snapshot (fact_backup)';
  END IF;
  IF to_regclass('fact_backup.claims') IS NOT NULL THEN
    CREATE TABLE IF NOT EXISTS fact_backup.dropped_by_rollback (claim jsonb NOT NULL, kept_at timestamptz NOT NULL DEFAULT now());
    INSERT INTO fact_backup.dropped_by_rollback (claim)
    SELECT to_jsonb(c) - 'embedding'
      FROM public.claims c
     WHERE NOT EXISTS (SELECT 1 FROM fact_backup.profile_entries e WHERE e.id = c.id)   -- made by the switch
       AND NOT (to_regclass('fact_retired.switch_closed_claims') IS NOT NULL               -- closed by the switch
                AND c.id IN (SELECT claim_id FROM fact_retired.switch_closed_claims)
                AND c.value = (SELECT b.value FROM fact_backup.claims b WHERE b.id = c.id))
       AND NOT EXISTS (SELECT 1 FROM fact_backup.claims b
                        WHERE b.id = c.id AND b.value = c.value AND b.attribute = c.attribute
                          AND b.subject_type = c.subject_type AND b.subject_id IS NOT DISTINCT FROM c.subject_id
                          AND b.valid_from IS NOT DISTINCT FROM c.valid_from AND b.valid_to IS NOT DISTINCT FROM c.valid_to);
  END IF;
END $$;

-- 2. Remove the new guards first, or they refuse or rewrite the restore.
DROP TRIGGER IF EXISTS trg_claims_a_preferred_wins ON public.claims;
DROP TRIGGER IF EXISTS trg_claims_b_quality_guard ON public.claims;
DROP TRIGGER IF EXISTS trg_claims_c_require_origin ON public.claims;
DROP TRIGGER IF EXISTS trg_claims_d_clear_embedding ON public.claims;
DROP TRIGGER IF EXISTS trg_claims_preferred_delete ON public.claims;
DROP TRIGGER IF EXISTS trg_profile_categories_keep_private_facts ON public.profile_categories;
DROP TRIGGER IF EXISTS claims_follow_contact_delete ON public.contacts;
DROP TRIGGER IF EXISTS claims_follow_entity_delete ON public.entities;

-- 3 and 4. Undo the switch, if it committed.
DO $$
DECLARE
  t text;
  cols text;
BEGIN
  IF to_regclass('public.profile_entries_archive') IS NULL THEN
    RETURN;
  END IF;

  -- The old world_claims, which reads the entry table.
  DROP VIEW IF EXISTS public.world_claims;
  ALTER VIEW fact_retired.world_claims SET SCHEMA public;

  DROP INDEX IF EXISTS public.claims_one_live_value;
  DROP TABLE IF EXISTS fact_retired.switch_closed_claims;
  ALTER TABLE public.profile_entries_archive RENAME TO profile_entries;
  GRANT ALL ON public.profile_entries TO anon, authenticated, service_role;

  -- Restore the rows. Explicit column lists: claims has rank until step 5.
  TRUNCATE public.profile_entries, public.profile_categories, public.claims, public.ai_suggestion_suppressions;
  FOREACH t IN ARRAY ARRAY['profile_categories','claims','profile_entries','ai_suggestion_suppressions'] LOOP
    SELECT string_agg(quote_ident(b.column_name), ', ' ORDER BY b.ordinal_position) INTO cols
      FROM information_schema.columns b
     WHERE b.table_schema = 'fact_backup' AND b.table_name = t
       AND EXISTS (SELECT 1 FROM information_schema.columns p
                    WHERE p.table_schema = 'public' AND p.table_name = t AND p.column_name = b.column_name);
    EXECUTE format('INSERT INTO public.%I (%s) SELECT %s FROM fact_backup.%I', t, cols, cols, t);
  END LOOP;

  -- Review items the switch re-pointed or superseded; items created since B1 stay.
  UPDATE public.review_queue r
     SET target_entity_type = 'profile_entry', target_entity_id = (r.payload->'fact_store_switch'->>'entry_id')::uuid
   WHERE r.payload->'fact_store_switch' ? 'entry_id';
  UPDATE public.review_queue r
     SET status = r.payload->'fact_store_switch'->>'prior_status'
   WHERE r.payload->'fact_store_switch' ? 'prior_status' AND r.status = 'superseded';
  UPDATE public.review_queue r SET payload = r.payload - 'fact_store_switch'
   WHERE r.payload ? 'fact_store_switch';

  -- Foreign keys, then the old functions, then the old triggers, after the data.
  ALTER TABLE public.profile_entries ADD CONSTRAINT profile_entries_derived_from_claim_id_fkey
    FOREIGN KEY (derived_from_claim_id) REFERENCES public.claims(id) ON DELETE SET NULL;
  ALTER TABLE public.profile_entries ADD CONSTRAINT profile_entries_category_id_fkey
    FOREIGN KEY (category_id) REFERENCES public.profile_categories(id) ON DELETE CASCADE;

  ALTER FUNCTION fact_retired.handle_profile_entries_enqueue_normalization() SET SCHEMA public;
  ALTER FUNCTION fact_retired.profile_entries_atomize() SET SCHEMA public;
  ALTER FUNCTION fact_retired.profile_entry_canonicalize() SET SCHEMA public;
  ALTER FUNCTION fact_retired.profile_entries_mark_audit_dirty() SET SCHEMA public;
  ALTER FUNCTION fact_retired.profile_entries_prevent_duplicate_fact() SET SCHEMA public;
  ALTER FUNCTION fact_retired.profile_entry_quality_guard() SET SCHEMA public;
  ALTER FUNCTION fact_retired.profile_entry_end_claim() SET SCHEMA public;
  ALTER FUNCTION fact_retired.profile_entry_require_origin() SET SCHEMA public;
  ALTER FUNCTION fact_retired.profile_entry_sync_claim() SET SCHEMA public;
  ALTER FUNCTION fact_retired.backfill_accumulator_profile_entries() SET SCHEMA public;
  ALTER FUNCTION fact_retired.cleanup_profile_duplicates(uuid, uuid) SET SCHEMA public;
  ALTER FUNCTION fact_retired.cleanup_profile_token_duplicates() SET SCHEMA public;
  ALTER FUNCTION fact_retired.profile_dedup_sweep(uuid, uuid, boolean) SET SCHEMA public;
  ALTER FUNCTION fact_retired.profile_subset_label_sweep(uuid, uuid, boolean) SET SCHEMA public;
  ALTER FUNCTION fact_retired.profile_existing_token_keys(uuid, uuid, text, uuid) SET SCHEMA public;
  ALTER FUNCTION fact_retired.profile_resolve_label(uuid, uuid, uuid, text, text) SET SCHEMA public;
  ALTER FUNCTION fact_retired.profile_entries_dedup_before_insert() SET SCHEMA public;
  ALTER FUNCTION fact_retired.profile_audit_apply_merge(uuid, uuid, uuid[], text, text, text) SET SCHEMA public;
  ALTER FUNCTION fact_retired.profile_audit_rollback_merge(uuid) SET SCHEMA public;

  ALTER TABLE public.profile_entries ENABLE TRIGGER USER;

  -- The merge and its trigger, as they were.
  DROP TRIGGER contact_merge_move_references ON public.contacts;
  DROP FUNCTION public.contact_merge_move_references();
  ALTER FUNCTION fact_retired.contact_merge_move_references() SET SCHEMA public;
  CREATE TRIGGER contact_merge_move_references AFTER UPDATE OF merged_into ON public.contacts
    FOR EACH ROW WHEN (((old.merged_into IS NULL) AND (new.merged_into IS NOT NULL) AND (new.merged_into <> new.id)))
    EXECUTE FUNCTION public.contact_merge_move_references();
  DROP FUNCTION public.merge_contacts_atomic(uuid, uuid, uuid, boolean);
  ALTER FUNCTION fact_retired.merge_contacts_atomic(uuid, uuid, uuid, boolean) SET SCHEMA public;
END $$;

-- 5. Undo the schema migration.
DROP VIEW IF EXISTS public.agent_facts;
DROP VIEW IF EXISTS public.profile_facts;
DROP FUNCTION IF EXISTS public.fact_today(uuid);
DROP TABLE IF EXISTS public.fact_slots;
DROP FUNCTION IF EXISTS public.claim_preferred_wins();
DROP FUNCTION IF EXISTS public.claim_preferred_survives_delete();
DROP FUNCTION IF EXISTS public.claim_quality_guard();
DROP FUNCTION IF EXISTS public.claim_require_origin();
DROP FUNCTION IF EXISTS public.claim_clear_embedding();
DROP FUNCTION IF EXISTS public.claims_follow_subject_delete();
DROP FUNCTION IF EXISTS public.profile_category_keeps_private_facts();
DO $$
BEGIN
  IF to_regprocedure('fact_retired.match_claims(extensions.vector,double precision,integer,uuid,date)') IS NOT NULL THEN
    DROP FUNCTION IF EXISTS public.match_claims(extensions.vector, double precision, integer, uuid, date);
    ALTER FUNCTION fact_retired.match_claims(extensions.vector, double precision, integer, uuid, date) SET SCHEMA public;
  END IF;
END $$;
ALTER TABLE public.claims DROP CONSTRAINT IF EXISTS claims_origin_known;
ALTER TABLE public.claims DROP CONSTRAINT IF EXISTS claims_source_type_check;
ALTER TABLE public.claims ADD CONSTRAINT claims_source_type_check
  CHECK (source_type = ANY (ARRAY['note'::text, 'moment'::text, 'manual'::text, 'ai'::text]));
ALTER TABLE public.claims DROP COLUMN IF EXISTS rank;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE pronamespace = to_regnamespace('fact_retired'))
     OR EXISTS (SELECT 1 FROM pg_class WHERE relnamespace = to_regnamespace('fact_retired')) THEN
    RAISE EXCEPTION 'fact_store_rollback: fact_retired is not empty after the rollback';
  END IF;
END $$;
DROP SCHEMA IF EXISTS fact_retired;

-- 7. Resume the jobs paused in B1 (on production only; 4 and 15 stay paused).
DO $$
DECLARE
  j int;
BEGIN
  IF to_regprocedure('cron.alter_job(bigint,text,text,text,text,boolean)') IS NOT NULL THEN
    FOREACH j IN ARRAY ARRAY[9, 11, 12, 16, 18] LOOP
      PERFORM cron.alter_job(j, active := true);
    END LOOP;
  END IF;
END $$;

-- Check: row counts equal the snapshot, and RLS and policies equal B16.
DO $$
DECLARE
  t text;
  live bigint;
  kept bigint;
  b16 jsonb;
BEGIN
  IF to_regclass('fact_backup.meta') IS NULL THEN RETURN; END IF;
  FOREACH t IN ARRAY ARRAY['profile_entries','profile_categories','claims','ai_suggestion_suppressions'] LOOP
    EXECUTE format('SELECT count(*) FROM public.%I', t) INTO live;
    EXECUTE format('SELECT count(*) FROM fact_backup.%I', t) INTO kept;
    IF live <> kept THEN RAISE EXCEPTION 'fact_store_rollback: % has % rows, the snapshot %', t, live, kept; END IF;
  END LOOP;
  SELECT m.b16 INTO b16 FROM fact_backup.meta m;
  IF b16 IS DISTINCT FROM (SELECT jsonb_object_agg(c.relname, jsonb_build_object(
                             'rls', c.relrowsecurity,
                             'policies', (SELECT count(*) FROM pg_policy p WHERE p.polrelid = c.oid)))
                             FROM pg_class c
                            WHERE c.relnamespace = 'public'::regnamespace
                              AND c.relname IN ('profile_entries','profile_categories','claims','review_queue','ai_suggestion_suppressions')) THEN
    RAISE EXCEPTION 'fact_store_rollback: RLS or policy counts differ from B16';
  END IF;
END $$;

SELECT (SELECT count(*) FROM fact_backup.dropped_by_rollback) AS claims_kept_in_dropped_by_rollback
 WHERE to_regclass('fact_backup.dropped_by_rollback') IS NOT NULL;
