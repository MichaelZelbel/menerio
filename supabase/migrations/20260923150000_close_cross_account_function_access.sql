-- Close database functions that any caller could point at another account.
--
-- Found by the 2026-09-23 migration audit. Two patterns, both SECURITY DEFINER
-- (so RLS does not apply inside) and both reachable through PostgREST's /rpc:
--
-- 1. Search functions that take the account as an argument and never compare
--    it with the caller. match_notes, match_note_chunks, match_media,
--    match_claims and match_person_documents all read `WHERE user_id =
--    p_user_id` with p_user_id supplied by the client, and none of them was
--    ever revoked from anon or authenticated. Anyone holding the public anon
--    key (it ships in the web bundle), or any signed-up account, could call
--
--      rpc('match_note_chunks', { query_embedding: <any 1536 vector>,
--          match_threshold: -1, match_count: 1000, p_user_id: <someone> })
--
--    and receive that person's note text, media OCR, dated facts or person
--    documents. match_claims even had an explicit GRANT to authenticated.
--    Every caller in this repository is an edge function holding the service
--    key and passing the id of the user it already authenticated, so the
--    functions now accept: the service role, a session with no JWT at all (the
--    database itself, the same rule enqueue_note_ai_job follows since
--    20260916120000), or a signed-in user asking about their own account.
--
-- 2. Functions meant for the service role whose REVOKE missed a role.
--    Supabase's default privileges grant EXECUTE on every new public function
--    explicitly to anon, authenticated and service_role, on top of Postgres's
--    own grant to PUBLIC, so a function is closed only when PUBLIC, anon and
--    authenticated are all revoked (20260920120000 and 20260917100000 do it
--    that way). Several did not:
--
--    - the note AI job functions (20260907120000, ...124000, ...125000,
--      20260911003000) revoked PUBLIC and authenticated but not anon. Most
--      raise 'service only' inside, but note_ai_input() has no check and
--      returns a note's title, content, metadata and media text for any
--      (user id, note id) pair.
--    - cleanup_profile_duplicates(_user_id, _contact_id) was GRANTed to
--      authenticated and deletes and rewrites the named account's profile
--      entries and writes to its review queue. Nothing in the app calls it.
--    - backfill_accumulator_profile_entries() is the one-time backfill of
--      20260724180943. It was never revoked, so anyone could re-run a merge
--      and delete pass over every account's profile entries.
--    - deduct_ai_tokens (both overloads) was never revoked: any caller could
--      charge any account's AI allowance down to zero. It is only reached
--      through deduct_ai_tokens_attributed, which runs as the owner.
--    - enqueue_profile_normalization_job revoked PUBLIC only, so anon and
--      authenticated could queue paid normalization runs for any account.
--    - llm_note_call_fingerprint and the three profile_audit_* functions
--      revoked anon and authenticated but not PUBLIC, which grants both of
--      them again. profile_audit_rollback_merge(_merge_id) has no owner check.
--    - review_queue_relationship_block_reason and user_today take an account
--      id and answer about it; only definer functions call them.
--
-- Every function in part 2 is called either by an edge function with the
-- service key or from inside another SECURITY DEFINER function (which runs as
-- the owner), so none of those callers loses access. Trigger functions are
-- only revoked from anon; calling one through /rpc fails anyway.
--
-- match_notes also gains one filter: it returned notes the user had hidden
-- from AI (notes.ai_visibility = 'hidden'). Its only callers are the four
-- connection functions (compute-connections, find-connections,
-- suggest-connections, recompute-all-connections). Each of them skips a hidden
-- SOURCE note but took the matches as they came, so a hidden note could be
-- linked as a connection, or its title and content could be sent to the model
-- as a suggestion candidate. match_note_chunks and match_media are left as
-- they are: the app's own search (search-notes-semantic, caller "app") shows
-- hidden notes to their owner on purpose and filters for MCP callers itself.
--
-- Bodies in part 1 are the current ones (match_notes 20260308134001,
-- match_media 20260401153639, match_note_chunks 20260509120141, match_claims
-- 20260901099000, match_person_documents 20260817140000) with the check added
-- and nothing else changed (apart from the match_notes filter above).

-- 1. SEARCH FUNCTIONS: THE CALLER MAY ONLY SEARCH ITS OWN ACCOUNT --------------

CREATE OR REPLACE FUNCTION public.match_notes(
  query_embedding extensions.vector(1536),
  match_threshold float DEFAULT 0.7,
  match_count int DEFAULT 10,
  p_user_id uuid DEFAULT auth.uid()
)
RETURNS TABLE (
  id uuid,
  title text,
  content text,
  metadata jsonb,
  tags text[],
  similarity float,
  created_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.role() IS NOT NULL AND auth.role() <> 'service_role' AND auth.uid() IS DISTINCT FROM p_user_id THEN
    RAISE EXCEPTION 'not authorized' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT
    n.id,
    n.title,
    n.content,
    n.metadata,
    n.tags,
    (1 - (n.embedding operator(extensions.<=>) query_embedding))::float AS similarity,
    n.created_at
  FROM public.notes n
  WHERE n.user_id = p_user_id
    AND n.is_trashed = false
    -- A note hidden from AI never comes back as a candidate (see header).
    AND n.ai_visibility = 'visible'
    AND (1 - (n.embedding operator(extensions.<=>) query_embedding))::float > match_threshold
  ORDER BY n.embedding operator(extensions.<=>) query_embedding
  LIMIT match_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.match_media(
  query_embedding extensions.vector,
  match_threshold double precision DEFAULT 0.5,
  match_count integer DEFAULT 10,
  p_user_id uuid DEFAULT auth.uid()
)
RETURNS TABLE(
  id uuid,
  note_id uuid,
  note_title text,
  storage_path text,
  media_type text,
  page_number integer,
  original_filename text,
  description text,
  extracted_text text,
  topics text[],
  raw_analysis jsonb,
  similarity double precision,
  created_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF auth.role() IS NOT NULL AND auth.role() <> 'service_role' AND auth.uid() IS DISTINCT FROM p_user_id THEN
    RAISE EXCEPTION 'not authorized' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT
    ma.id,
    ma.note_id,
    n.title AS note_title,
    ma.storage_path,
    ma.media_type,
    ma.page_number,
    ma.original_filename,
    ma.description,
    ma.extracted_text,
    ma.topics,
    ma.raw_analysis,
    (1 - (ma.embedding operator(extensions.<=>) query_embedding))::float AS similarity,
    ma.created_at
  FROM public.media_analysis ma
  JOIN public.notes n ON n.id = ma.note_id
  WHERE ma.user_id = p_user_id
    AND ma.analysis_status = 'complete'
    AND ma.embedding IS NOT NULL
    AND (1 - (ma.embedding operator(extensions.<=>) query_embedding))::float > match_threshold
  ORDER BY ma.embedding operator(extensions.<=>) query_embedding
  LIMIT match_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.match_note_chunks(
  query_embedding extensions.vector,
  match_threshold double precision DEFAULT 0.25,
  match_count integer DEFAULT 20,
  p_user_id uuid DEFAULT auth.uid()
)
RETURNS TABLE (
  chunk_id uuid,
  note_id uuid,
  chunk_index integer,
  heading_path text,
  content text,
  similarity double precision,
  note_title text,
  note_created_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF auth.role() IS NOT NULL AND auth.role() <> 'service_role' AND auth.uid() IS DISTINCT FROM p_user_id THEN
    RAISE EXCEPTION 'not authorized' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT
    nc.id AS chunk_id,
    nc.note_id,
    nc.chunk_index,
    nc.heading_path,
    nc.content,
    (1 - (nc.embedding operator(extensions.<=>) query_embedding))::float AS similarity,
    n.title AS note_title,
    n.created_at AS note_created_at
  FROM public.note_chunks nc
  JOIN public.notes n ON n.id = nc.note_id
  WHERE nc.user_id = p_user_id
    AND n.is_trashed = false
    AND nc.embedding IS NOT NULL
    AND (1 - (nc.embedding operator(extensions.<=>) query_embedding))::float > match_threshold
  ORDER BY nc.embedding operator(extensions.<=>) query_embedding
  LIMIT match_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.match_claims(
  query_embedding extensions.vector,
  match_threshold double precision DEFAULT 0.2,
  match_count integer DEFAULT 20,
  p_user_id uuid DEFAULT auth.uid(),
  p_as_of date DEFAULT NULL
)
RETURNS TABLE (
  id uuid,
  subject_type text,
  subject_id uuid,
  attribute text,
  value text,
  valid_from date,
  valid_to date,
  confidence text,
  cardinality text,
  review_by date,
  evidence_quote text,
  source_type text,
  source_id uuid,
  similarity double precision
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  as_of date;
BEGIN
  IF auth.role() IS NOT NULL AND auth.role() <> 'service_role' AND auth.uid() IS DISTINCT FROM p_user_id THEN
    RAISE EXCEPTION 'not authorized' USING ERRCODE = '42501';
  END IF;

  as_of := COALESCE(p_as_of, public.user_today(p_user_id));

  RETURN QUERY
  SELECT
    c.id, c.subject_type, c.subject_id, c.attribute, c.value,
    c.valid_from, c.valid_to, c.confidence, c.cardinality, c.review_by,
    c.evidence_quote, c.source_type, c.source_id,
    (1 - (c.embedding operator(extensions.<=>) query_embedding))::float AS similarity
  FROM public.claims c
  WHERE c.user_id = p_user_id
    AND c.embedding IS NOT NULL
    AND (c.valid_from IS NULL OR c.valid_from <= as_of)
    AND (c.valid_to   IS NULL OR c.valid_to   >  as_of)
    AND (
      c.subject_type <> 'contact'
      OR EXISTS (
        SELECT 1 FROM public.contacts ct
        WHERE ct.id = c.subject_id
          AND ct.user_id = p_user_id
          AND ct.merged_into IS NULL
          AND ct.is_sensitive IS NOT TRUE
          AND ct.ai_visibility = 'visible'
      )
    )
    AND (1 - (c.embedding operator(extensions.<=>) query_embedding)) > match_threshold
  ORDER BY c.embedding operator(extensions.<=>) query_embedding
  LIMIT match_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.match_person_documents(
  query_embedding extensions.vector(1536),
  match_person_id uuid,
  match_user_id uuid,
  match_threshold double precision DEFAULT 0.3,
  match_count integer DEFAULT 5
)
RETURNS TABLE (
  id uuid,
  title text,
  content text,
  similarity double precision
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  IF auth.role() IS NOT NULL AND auth.role() <> 'service_role' AND auth.uid() IS DISTINCT FROM match_user_id THEN
    RAISE EXCEPTION 'not authorized' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT
    pd.id,
    pd.title,
    pd.content,
    (1 - (pd.embedding <=> query_embedding))::double precision AS similarity
  FROM public.person_documents pd
  WHERE pd.user_id = match_user_id
    AND pd.person_id = match_person_id
    AND pd.memory_type = 'long_term'
    AND pd.embedding IS NOT NULL
    AND (1 - (pd.embedding <=> query_embedding))::double precision > match_threshold
  ORDER BY pd.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;

-- Signed-in users keep EXECUTE (the check above limits them to their own
-- account); the anon key loses it.
DO $$
DECLARE
  fn text;
BEGIN
  FOREACH fn IN ARRAY ARRAY[
    'public.match_notes(extensions.vector, double precision, integer, uuid)',
    'public.match_media(extensions.vector, double precision, integer, uuid)',
    'public.match_note_chunks(extensions.vector, double precision, integer, uuid)',
    'public.match_claims(extensions.vector, double precision, integer, uuid, date)',
    'public.match_person_documents(extensions.vector, uuid, uuid, double precision, integer)'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', fn);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM anon', fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated, service_role', fn);
  END LOOP;
END $$;

-- 2. SERVICE-ROLE-ONLY FUNCTIONS ----------------------------------------------
--
-- Looked up with to_regprocedure so a signature that differs on some database
-- is reported instead of aborting the whole repair; the check at the end fails
-- the migration if anything named here is still open to anon.

DO $$
DECLARE
  fn text;
BEGIN
  FOREACH fn IN ARRAY ARRAY[
    'public.note_ai_input(uuid, uuid, text)',
    'public.claim_note_ai_jobs(integer, integer, uuid)',
    'public.get_note_ai_job_snapshot(uuid, uuid, uuid)',
    'public.finish_note_ai_job(uuid, uuid, uuid)',
    'public.begin_note_ai_stage(uuid, uuid, uuid, text)',
    'public.checkpoint_note_ai_stage(uuid, uuid, uuid, text, jsonb)',
    'public.apply_note_ai_stage(uuid, uuid, uuid, text)',
    'public.fail_note_ai_job(uuid, uuid, uuid, text)',
    'public.claim_note_ai_execution(uuid, uuid, uuid)',
    'public.reanalyze_note_ai_job(uuid, uuid, text)',
    'public.wiki_apply_note_ai_result(uuid, uuid, uuid)',
    'public.apply_note_ai_output(uuid, uuid, uuid, jsonb, jsonb, text, text, boolean)',
    'public.replace_note_ai_chunks(uuid, uuid, uuid, jsonb)',
    'public.cleanup_profile_duplicates(uuid, uuid)',
    'public.backfill_accumulator_profile_entries()',
    'public.deduct_ai_tokens(uuid, integer, text, text, text, integer, integer, text)',
    'public.deduct_ai_tokens(uuid, integer, text, text, text, integer, integer, text, text)',
    'public.enqueue_profile_normalization_job(uuid, uuid, text)',
    'public.llm_note_call_fingerprint(uuid, text, text, interval, integer)',
    'public.profile_audit_mark_dirty(uuid, uuid)',
    'public.profile_audit_rollback_merge(uuid)',
    'public.profile_audit_apply_merge(uuid, uuid, uuid[], text, text, text)',
    'public.review_queue_relationship_block_reason(uuid, jsonb)',
    'public.user_today(uuid)'
  ] LOOP
    IF to_regprocedure(fn) IS NULL THEN
      RAISE NOTICE 'close_cross_account_function_access: % does not exist here, skipped', fn;
      CONTINUE;
    END IF;
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', fn);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM anon', fn);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM authenticated', fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', fn);
  END LOOP;

  -- Trigger functions: nobody but the trigger needs them.
  FOREACH fn IN ARRAY ARRAY[
    'public.note_ai_note_changed()',
    'public.note_ai_media_changed()',
    'public.note_ai_release_results()'
  ] LOOP
    IF to_regprocedure(fn) IS NULL THEN
      RAISE NOTICE 'close_cross_account_function_access: % does not exist here, skipped', fn;
      CONTINUE;
    END IF;
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', fn);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM anon', fn);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM authenticated', fn);
  END LOOP;
END $$;

-- 3. PROOF ---------------------------------------------------------------------

DO $$
DECLARE
  fn text;
  still_open text[] := ARRAY[]::text[];
BEGIN
  FOREACH fn IN ARRAY ARRAY[
    'public.match_notes(extensions.vector, double precision, integer, uuid)',
    'public.match_media(extensions.vector, double precision, integer, uuid)',
    'public.match_note_chunks(extensions.vector, double precision, integer, uuid)',
    'public.match_claims(extensions.vector, double precision, integer, uuid, date)',
    'public.match_person_documents(extensions.vector, uuid, uuid, double precision, integer)',
    'public.note_ai_input(uuid, uuid, text)',
    'public.cleanup_profile_duplicates(uuid, uuid)',
    'public.backfill_accumulator_profile_entries()',
    'public.deduct_ai_tokens(uuid, integer, text, text, text, integer, integer, text)',
    'public.deduct_ai_tokens(uuid, integer, text, text, text, integer, integer, text, text)',
    'public.enqueue_profile_normalization_job(uuid, uuid, text)',
    'public.llm_note_call_fingerprint(uuid, text, text, interval, integer)',
    'public.profile_audit_rollback_merge(uuid)',
    'public.user_today(uuid)'
  ] LOOP
    IF to_regprocedure(fn) IS NOT NULL AND has_function_privilege('anon', to_regprocedure(fn), 'EXECUTE') THEN
      still_open := still_open || fn;
    END IF;
  END LOOP;
  IF cardinality(still_open) > 0 THEN
    RAISE EXCEPTION 'still executable by anon: %', array_to_string(still_open, ', ');
  END IF;

  FOREACH fn IN ARRAY ARRAY[
    'public.note_ai_input(uuid, uuid, text)',
    'public.cleanup_profile_duplicates(uuid, uuid)',
    'public.backfill_accumulator_profile_entries()',
    'public.deduct_ai_tokens(uuid, integer, text, text, text, integer, integer, text)',
    'public.deduct_ai_tokens(uuid, integer, text, text, text, integer, integer, text, text)',
    'public.enqueue_profile_normalization_job(uuid, uuid, text)',
    'public.profile_audit_rollback_merge(uuid)'
  ] LOOP
    IF to_regprocedure(fn) IS NOT NULL AND has_function_privilege('authenticated', to_regprocedure(fn), 'EXECUTE') THEN
      still_open := still_open || fn;
    END IF;
  END LOOP;
  IF cardinality(still_open) > 0 THEN
    RAISE EXCEPTION 'still executable by authenticated: %', array_to_string(still_open, ', ');
  END IF;
END $$;
