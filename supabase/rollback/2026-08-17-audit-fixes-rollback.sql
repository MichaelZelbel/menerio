-- Rollback for the 2026-08-17 audit fixes.
--
-- None of the ten fixes ships a migration: every change is edge-function or
-- frontend code, so the rollback for those is `git revert` of the commits on
-- branch audit-fixes-2026-08-17 followed by a redeploy of the affected
-- functions. Nothing alters a live prompt row and nothing deletes data.
--
-- This file exists for the one piece of STATE a fix can leave behind.
--
-- process-note now claims a note by setting processing_status = 'processing'
-- before it spends anything, so two triggers cannot both pay to process the
-- same note. If a deploy is rolled back while runs are in flight, notes can be
-- left holding a claim, and the pre-fix code has no notion of releasing one.
--
-- In practice sweep-note-processing already re-triggers anything stuck in
-- 'processing' for more than 10 minutes, so this is belt and braces. Run it if
-- you want the claims cleared immediately rather than on the next sweep.

update public.notes
   set processing_status = 'pending',
       processing_error  = null
 where processing_status = 'processing'
   and updated_at < now() - interval '15 minutes';

-- Verify nothing is left stuck:
--   select processing_status, count(*)
--     from public.notes
--    group by 1
--    order by 2 desc;
