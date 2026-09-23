-- Proposed data repairs from the second-pass live audit, 2026-09-23.
-- NOT EXECUTED. Each block is independent; run one at a time in a transaction,
-- check the reported row count against the number given, then COMMIT.
-- The code causes were fixed in the repository the same evening (see
-- docs/AUDIT_2026-09-23.md, section "Second pass: the live system").

-- 1. Notes linking "Michael" to a contact that no longer exists --------------
-- 566 notes of account 4332607c (309 not trashed) carry, in
-- metadata.matched_people, an entry {name:"Michael", contact_id:"ca58bf73-..."}
-- for a deleted contact, usually next to a correct {is_self:true} entry.
-- Cause: process-note reused a remembered decision without checking the
-- contact still existed (fixed in process-note/index.ts).
-- Expected: UPDATE 566.
BEGIN;
UPDATE public.notes n
   SET metadata = jsonb_set(
         n.metadata, '{matched_people}',
         coalesce((SELECT jsonb_agg(e) FROM jsonb_array_elements(n.metadata->'matched_people') e
                    WHERE e->>'contact_id' IS DISTINCT FROM 'ca58bf73-0028-4b10-890a-36936343aa6b'), '[]'::jsonb))
 WHERE n.user_id = '4332607c-1ddd-4a5d-8765-a44963e4fe12'
   AND jsonb_typeof(n.metadata->'matched_people') = 'array'
   AND n.metadata->'matched_people' @> '[{"contact_id":"ca58bf73-0028-4b10-890a-36936343aa6b"}]';
-- COMMIT;

-- 2. Remembered name decisions that point at deleted or merged contacts ------
-- 7 rows. The worst: owner "michael" -> deleted contact, decision_count 790,
-- which outranks every other decision for that name forever. The table has no
-- foreign key. Deleting lets the decisions be relearned from live contacts.
-- Expected: DELETE 7.
BEGIN;
DELETE FROM public.name_disambiguation_decisions d
 WHERE d.target_contact_id IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM public.contacts c
                    WHERE c.id = d.target_contact_id AND c.merged_into IS NULL);
-- COMMIT;

-- 3. Notes whose processing_status says "processing" although the job failed -
-- apply_note_ai_output writes 'processing' on intermediate stages; when a later
-- stage fails nothing resets it. The editor reads the job state first, so this
-- is only visible to other readers of notes.processing_status. 3 rows today.
-- Expected: UPDATE 3.
BEGIN;
UPDATE public.notes n
   SET processing_status = 'failed', processing_error = j.last_error
  FROM public.note_ai_jobs j
 WHERE j.note_id = n.id AND j.pipeline = 'analysis'
   AND n.processing_status = 'processing' AND j.state = 'failed';
-- COMMIT;

-- 4. The two gdrive timers still use pg_net's 5 s default timeout ------------
-- In the 6 h of net._http_response kept live, 5 of 552 scheduled calls timed
-- out, all at hh:00 when four jobs fire together, most of them in DNS
-- resolution. internal.call_edge uses 10 s and none of its calls timed out.
-- The commands hold a literal secret, so this rewrites them in place instead
-- of committing them. Expected: two rows, each returning void.
-- SELECT cron.alter_job(jobid, command := replace(command, 'net.http_post(', 'net.http_post(timeout_milliseconds := 15000, '))
--   FROM cron.job WHERE jobname IN ('gdrive-sync-backstop', 'gdrive-watch-maintenance')
--    AND command NOT LIKE '%timeout_milliseconds%';

-- 5. Three identical unique indexes on godspeed_api_usage(key_id, window_start)
-- godspeed_api_usage_key_id_window_start_key (constraint),
-- godspeed_api_usage_key_window_unique (constraint, 20260402165028) and
-- idx_godspeed_api_usage_key_window (plain). Every rate-limit bump writes all
-- three. Keep the first.
-- ALTER TABLE public.godspeed_api_usage DROP CONSTRAINT godspeed_api_usage_key_window_unique;
-- DROP INDEX IF EXISTS public.idx_godspeed_api_usage_key_window;

-- 6. The migration ledger -----------------------------------------------------
-- supabase_migrations.schema_migrations lists 205 versions; the repository has
-- 225 files. Older Lovable migrations are recorded under a version one or two
-- seconds off their file name, and 27 files from 20260816 to 20260920 were
-- applied by hand and never recorded (their tables and functions exist live).
-- `supabase db push` would try to run all of them again. Before any push,
-- verify each and record it with `supabase migration repair --status applied
-- <version>`; do not record today's unapplied files (20260923161000 onward).
