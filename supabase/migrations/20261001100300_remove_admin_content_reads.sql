-- Level 1 privacy: staff cannot read what users wrote. Admins keep account,
-- billing and moderation-metadata access only. Keep the allowlist identical to
-- scripts/check-admin-read-policies.mjs.
-- Deploy the new moderate-content / ai-moderate-content BEFORE this: the CHECKs
-- below refuse the text copies the old versions still write.

-- 1. Drop the named admin read rules. A table may be gone (fact-store go-live),
--    so each drop is guarded. The statements are written out literally, not
--    built with format(), so scripts/check-admin-read-policies.mjs can see them.
DO $$ BEGIN IF to_regclass('public.note_chunks') IS NOT NULL THEN
  DROP POLICY IF EXISTS "Admins can view all note chunks" ON public.note_chunks; END IF; END $$;
DO $$ BEGIN IF to_regclass('public.media_analysis') IS NOT NULL THEN
  DROP POLICY IF EXISTS "Admins can view all media analysis" ON public.media_analysis; END IF; END $$;
DO $$ BEGIN IF to_regclass('public.profile_entries') IS NOT NULL THEN
  DROP POLICY IF EXISTS "Admins can view all profile entries" ON public.profile_entries; END IF; END $$;
DO $$ BEGIN IF to_regclass('public.profile_entries_archive') IS NOT NULL THEN
  DROP POLICY IF EXISTS "Admins can view all profile entries" ON public.profile_entries_archive; END IF; END $$;
DO $$ BEGIN IF to_regclass('public.profile_categories') IS NOT NULL THEN
  DROP POLICY IF EXISTS "Admins can view all profile categories" ON public.profile_categories; END IF; END $$;
DO $$ BEGIN IF to_regclass('public.profile_views') IS NOT NULL THEN
  DROP POLICY IF EXISTS "Admins can view all profile views" ON public.profile_views; END IF; END $$;
DO $$ BEGIN IF to_regclass('public.agent_instructions') IS NOT NULL THEN
  DROP POLICY IF EXISTS "Admins can view all agent instructions" ON public.agent_instructions; END IF; END $$;
DO $$ BEGIN IF to_regclass('public.profiles') IS NOT NULL THEN
  DROP POLICY IF EXISTS "Admins can view all profiles" ON public.profiles; END IF; END $$;

-- 2. Activity: owner only (it was "own OR admin").
DROP POLICY IF EXISTS "Users can view own events" ON public.activity_events;
CREATE POLICY "Users can view own events" ON public.activity_events
  FOR SELECT TO authenticated USING (actor_id = auth.uid());

-- 3. Moderation keeps references, never text. Wipe the old copies, refuse new ones.
UPDATE public.moderation_review_queue SET content_snapshot = NULL, ai_reason = NULL
  WHERE content_snapshot IS NOT NULL OR ai_reason IS NOT NULL;
UPDATE public.moderation_events SET flagged_content = NULL WHERE flagged_content IS NOT NULL;
ALTER TABLE public.moderation_review_queue
  ADD CONSTRAINT moderation_review_queue_no_copy CHECK (content_snapshot IS NULL AND ai_reason IS NULL);
ALTER TABLE public.moderation_events
  ADD CONSTRAINT moderation_events_no_copy CHECK (flagged_content IS NULL);

-- 4. Refuse to finish if any admin read rule is left outside the allowlist,
--    whatever it is called (production has drifted from the repo before).
CREATE SCHEMA IF NOT EXISTS private;
CREATE OR REPLACE FUNCTION private.assert_no_admin_content_reads() RETURNS void
LANGUAGE plpgsql AS $$
DECLARE bad text;
BEGIN
  SELECT string_agg(format('%s.%s "%s"', schemaname, tablename, policyname), '; ') INTO bad
  FROM pg_policies
  WHERE cmd IN ('SELECT', 'ALL')
    AND (coalesce(qual, '') ~* 'is_admin|''admin''' OR coalesce(with_check, '') ~* 'is_admin|''admin''')
    AND NOT (schemaname = 'public' AND tablename = ANY (ARRAY[
      'user_roles','ai_allowance_periods','user_suspensions','llm_usage_events',
      'llm_call_configs','moderation_stopwords','moderation_events',
      'moderation_review_queue','ai_credit_settings']));
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'Admin read access left on user content: %', bad;
  END IF;
END $$;
REVOKE ALL ON FUNCTION private.assert_no_admin_content_reads() FROM PUBLIC, anon, authenticated;
SELECT private.assert_no_admin_content_reads();
