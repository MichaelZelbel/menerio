-- Second-pass audit of the live database, 2026-09-23 (evening).
--
-- 20260923150000 closed the functions the repository knew about. The live
-- catalogue had more: functions whose live privileges do not match any
-- migration, because they were created or re-created by hand.
--
-- 1. The Mission Control connect flow. 20260920120000 ends with a block that
--    revokes every godspeed_connect_* function from PUBLIC, anon and
--    authenticated. That migration is not recorded in
--    supabase_migrations.schema_migrations and the live ACL of all seven
--    functions is {=X, anon=X, authenticated=X, service_role=X}: the revoke
--    never ran live. As a result anyone holding the public anon key could call
--    godspeed_connect_start to open a request with a code of their own
--    choosing, godspeed_connect_decide to approve it for any account id, and
--    godspeed_connect_collect to store a key hash of their own, which is an API
--    key on someone else's account. The migration's own comment names this
--    exact risk. godspeed_api_bump_usage (20260909120000) is in the same state
--    and lets anyone exhaust another key's rate-limit window.
--    Every caller is mc-connect / _shared/mc-rate-limit.ts with the service key.
--
-- 2. profile_dedup_sweep and profile_subset_label_sweep exist only live (no
--    migration creates them). Both are SECURITY DEFINER, take a user id, never
--    compare it with the caller, and rewrite and DELETE that account's profile
--    entries. Both were executable by anon. Nothing in the repository calls
--    them. profile_resolve_label is the same kind of function but read-only,
--    and the invoker trigger profile_entry_canonicalize calls it while an
--    authenticated user writes a profile entry, so authenticated keeps it and
--    only PUBLIC and anon lose it.
--
-- 3. "Anyone can view avatars" let anon LIST the avatars bucket, and avatar
--    paths start with the account id: a list of every account id, which is the
--    only input item 1 needed. Public URLs of a public bucket do not go through
--    RLS, so avatar images keep working; the owner keeps SELECT on their own
--    folder, which upload(..., {upsert: true}) and remove() need.

DO $$
DECLARE
  fn text;
BEGIN
  FOREACH fn IN ARRAY ARRAY[
    'public.godspeed_connect_start(uuid, text, uuid, text, text, jsonb, text, text, text, integer, integer)',
    'public.godspeed_connect_open_request(uuid, uuid)',
    'public.godspeed_connect_view(uuid, uuid)',
    'public.godspeed_connect_decide(uuid, uuid, text, boolean, boolean, integer)',
    'public.godspeed_connect_collect(uuid, text, uuid, text, text, text[], integer, integer)',
    'public.godspeed_connect_touch(uuid, uuid, text, text, text)',
    'public.godspeed_connect_disconnect(uuid, uuid, uuid)',
    'public.godspeed_api_bump_usage(uuid, timestamptz, integer)',
    'public.profile_dedup_sweep(uuid, uuid, boolean)',
    'public.profile_subset_label_sweep(uuid, uuid, boolean)'
  ] LOOP
    IF to_regprocedure(fn) IS NULL THEN
      RAISE NOTICE 'close_live_only_function_grants: % does not exist here, skipped', fn;
      CONTINUE;
    END IF;
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', fn);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM anon', fn);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM authenticated', fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', fn);
  END LOOP;

  IF to_regprocedure('public.profile_resolve_label(uuid, uuid, uuid, text, text)') IS NOT NULL THEN
    REVOKE ALL ON FUNCTION public.profile_resolve_label(uuid, uuid, uuid, text, text) FROM PUBLIC;
    REVOKE ALL ON FUNCTION public.profile_resolve_label(uuid, uuid, uuid, text, text) FROM anon;
    GRANT EXECUTE ON FUNCTION public.profile_resolve_label(uuid, uuid, uuid, text, text) TO authenticated, service_role;
  END IF;
END $$;

DROP POLICY IF EXISTS "Anyone can view avatars" ON storage.objects;
DROP POLICY IF EXISTS "Users can view their own avatar" ON storage.objects;
CREATE POLICY "Users can view their own avatar" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'avatars' AND (storage.foldername(name))[1] = (auth.uid())::text);

-- PROOF -------------------------------------------------------------------------

DO $$
DECLARE
  fn text;
  still_open text[] := ARRAY[]::text[];
BEGIN
  FOREACH fn IN ARRAY ARRAY[
    'public.godspeed_connect_start(uuid, text, uuid, text, text, jsonb, text, text, text, integer, integer)',
    'public.godspeed_connect_open_request(uuid, uuid)',
    'public.godspeed_connect_view(uuid, uuid)',
    'public.godspeed_connect_decide(uuid, uuid, text, boolean, boolean, integer)',
    'public.godspeed_connect_collect(uuid, text, uuid, text, text, text[], integer, integer)',
    'public.godspeed_connect_touch(uuid, uuid, text, text, text)',
    'public.godspeed_connect_disconnect(uuid, uuid, uuid)',
    'public.godspeed_api_bump_usage(uuid, timestamptz, integer)',
    'public.profile_dedup_sweep(uuid, uuid, boolean)',
    'public.profile_subset_label_sweep(uuid, uuid, boolean)'
  ] LOOP
    IF to_regprocedure(fn) IS NOT NULL AND (
         has_function_privilege('anon', to_regprocedure(fn), 'EXECUTE')
      OR has_function_privilege('authenticated', to_regprocedure(fn), 'EXECUTE')) THEN
      still_open := still_open || fn;
    END IF;
  END LOOP;
  IF to_regprocedure('public.profile_resolve_label(uuid, uuid, uuid, text, text)') IS NOT NULL
     AND has_function_privilege('anon', 'public.profile_resolve_label(uuid, uuid, uuid, text, text)'::regprocedure, 'EXECUTE') THEN
    still_open := still_open || 'public.profile_resolve_label(uuid, uuid, uuid, text, text)'::text;
  END IF;
  IF cardinality(still_open) > 0 THEN
    RAISE EXCEPTION 'still executable by a client role: %', array_to_string(still_open, ', ');
  END IF;
END $$;
