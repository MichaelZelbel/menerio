-- Audit of 2026-09-29: five visibility helpers answered for any account, and
-- ai_can_see misread the people a note names.
--
-- ai_can_see, ai_hidden_counts, mcp_sensitive_person_ids and their two mcp_*
-- wrappers are SECURITY DEFINER, take an account id and never compare it with
-- the caller. 20260529213515 and 20260523114159 granted them to authenticated,
-- so any signed-in account could call them with another account's id and read
-- how many of that account's notes, contacts, moments and action items are
-- hidden from AI, the ids of the people it marked sensitive, and whether a
-- given id exists there and is visible to AI.
--
-- Nothing signed in calls them. The callers are edge functions with the
-- service key (menerio-mcp/_ai_visibility.ts, _shared/contact-topics.ts) and
-- apply_contact_topic_command_for_user, which is SECURITY DEFINER itself and so
-- calls them as its owner. The live catalogue has no view or policy that uses
-- them. So authenticated loses them, like anon already had.
--
-- increment_collection_template_usage was executable by anon: anyone could
-- raise any template's usage count. Only the signed-in templates page calls it.
--
-- ai_can_see's note branch read notes.metadata.matched_people as a list of id
-- strings (jsonb_array_elements_text(...)::uuid). Every writer stores objects,
-- {name, contact_id, canonical_name}; live, all 3,206 entries on 1,015 notes
-- are objects. So a note about a sensitive person was never hidden, and once an
-- account marks anyone sensitive the cast raises "invalid input syntax for type
-- uuid" for every note that names someone, which fails MCP update_note and
-- trash_note on those notes. The branch now reads contact_id from an object
-- and still accepts a plain id string, and never casts.
--
-- get_shared_note_by_token did not look at the trash, so a trashed note stayed
-- public to anyone holding its share link. The get-shared-note function now
-- reads the tables itself, but the RPC is still executable by anon.

CREATE OR REPLACE FUNCTION public.get_shared_note_by_token(p_token text)
 RETURNS jsonb
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT jsonb_build_object('title', n.title, 'content', n.content, 'tags', n.tags,
    'entity_type', n.entity_type, 'created_at', n.created_at, 'updated_at', n.updated_at)
  FROM public.shared_notes s JOIN public.notes n ON n.id=s.note_id AND n.user_id=s.user_id
  WHERE s.share_token=p_token AND s.is_active=true AND n.is_trashed IS NOT TRUE
$function$;

-- A suspended account could still publish notes. The share page asks
-- moderate-content first, which refuses a suspended account, but then writes
-- the shared_notes row itself through row-level security, so the same call
-- made directly with the account's session published anyway. The database now
-- refuses to create or re-activate a share for a suspended account whose
-- suspension has not run out. Turning a share off stays allowed.

CREATE OR REPLACE FUNCTION public.shared_notes_refuse_suspended()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.is_active IS TRUE
     AND (TG_OP = 'INSERT' OR OLD.is_active IS DISTINCT FROM TRUE)
     AND EXISTS (
       SELECT 1 FROM public.user_suspensions s
       WHERE s.user_id = NEW.user_id AND s.suspended IS TRUE
         AND (s.suspended_until IS NULL OR s.suspended_until > now())
     ) THEN
    RAISE EXCEPTION 'This account is suspended, so it cannot share notes.' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.shared_notes_refuse_suspended() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS shared_notes_refuse_suspended ON public.shared_notes;
CREATE TRIGGER shared_notes_refuse_suspended
  BEFORE INSERT OR UPDATE OF is_active ON public.shared_notes
  FOR EACH ROW EXECUTE FUNCTION public.shared_notes_refuse_suspended();

CREATE OR REPLACE FUNCTION public.ai_can_see(_user_id uuid, _kind text, _id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_visible boolean := false;
  v_hide_sensitive boolean := true;
BEGIN
  SELECT COALESCE(hide_sensitive_from_ai, true) INTO v_hide_sensitive
  FROM public.mcp_preferences WHERE user_id = _user_id;
  IF v_hide_sensitive IS NULL THEN v_hide_sensitive := true; END IF;

  IF _kind = 'note' THEN
    SELECT (n.ai_visibility = 'visible'
            AND (NOT v_hide_sensitive OR NOT EXISTS (
              SELECT 1 FROM public.contacts c
              WHERE c.id::text IN (
                SELECT COALESCE(e->>'contact_id', CASE WHEN jsonb_typeof(e) = 'string' THEN e #>> '{}' END)
                FROM jsonb_array_elements(
                  CASE WHEN jsonb_typeof(n.metadata->'matched_people') = 'array'
                       THEN n.metadata->'matched_people' ELSE '[]'::jsonb END) e
              )
              AND c.user_id = _user_id AND c.is_sensitive = true
            )))
    INTO v_visible
    FROM public.notes n WHERE n.id = _id AND n.user_id = _user_id;

  ELSIF _kind = 'contact' THEN
    SELECT (ai_visibility = 'visible') INTO v_visible
    FROM public.contacts WHERE id = _id AND user_id = _user_id;

  ELSIF _kind = 'moment' THEN
    SELECT (m.ai_visibility = 'visible'
            AND (NOT v_hide_sensitive OR NOT EXISTS (
              SELECT 1 FROM public.moment_participants mp
              JOIN public.contacts c ON c.id = mp.person_id
              WHERE mp.moment_id = m.id AND c.is_sensitive = true AND c.user_id = _user_id
            ))
            AND (NOT v_hide_sensitive OR m.person_id IS NULL OR NOT EXISTS (
              SELECT 1 FROM public.contacts c WHERE c.id = m.person_id AND c.is_sensitive = true AND c.user_id = _user_id
            )))
    INTO v_visible
    FROM public.moments m WHERE m.id = _id AND m.user_id = _user_id;

  ELSIF _kind = 'action_item' THEN
    SELECT (a.ai_visibility = 'visible'
            AND (NOT v_hide_sensitive OR a.contact_id IS NULL OR NOT EXISTS (
              SELECT 1 FROM public.contacts c WHERE c.id = a.contact_id AND c.is_sensitive = true AND c.user_id = _user_id
            )))
    INTO v_visible
    FROM public.action_items a WHERE a.id = _id AND a.user_id = _user_id;

  ELSIF _kind = 'collection_item' THEN
    SELECT (ai_visibility = 'visible') INTO v_visible
    FROM public.collection_items WHERE id = _id AND user_id = _user_id;
  END IF;

  RETURN COALESCE(v_visible, false);
END;
$function$;

DO $$
DECLARE
  fn text;
BEGIN
  FOREACH fn IN ARRAY ARRAY[
    'public.ai_can_see(uuid, text, uuid)',
    'public.ai_hidden_counts(uuid)',
    'public.mcp_can_see(uuid, text, uuid)',
    'public.mcp_hidden_counts(uuid)',
    'public.mcp_sensitive_person_ids(uuid)'
  ] LOOP
    IF to_regprocedure(fn) IS NOT NULL THEN
      EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon, authenticated', fn);
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', fn);
    END IF;
  END LOOP;

  IF to_regprocedure('public.increment_collection_template_usage(text)') IS NOT NULL THEN
    REVOKE EXECUTE ON FUNCTION public.increment_collection_template_usage(text) FROM PUBLIC, anon;
    GRANT EXECUTE ON FUNCTION public.increment_collection_template_usage(text) TO authenticated, service_role;
  END IF;
END $$;

DO $$
DECLARE
  fn text;
  still_open text[] := ARRAY[]::text[];
BEGIN
  FOREACH fn IN ARRAY ARRAY[
    'public.ai_can_see(uuid, text, uuid)',
    'public.ai_hidden_counts(uuid)',
    'public.mcp_can_see(uuid, text, uuid)',
    'public.mcp_hidden_counts(uuid)',
    'public.mcp_sensitive_person_ids(uuid)'
  ] LOOP
    IF to_regprocedure(fn) IS NOT NULL AND (
         has_function_privilege('anon', to_regprocedure(fn), 'EXECUTE')
      OR has_function_privilege('authenticated', to_regprocedure(fn), 'EXECUTE')) THEN
      still_open := still_open || fn;
    END IF;
  END LOOP;
  IF to_regprocedure('public.increment_collection_template_usage(text)') IS NOT NULL
     AND has_function_privilege('anon', 'public.increment_collection_template_usage(text)'::regprocedure, 'EXECUTE') THEN
    still_open := still_open || 'public.increment_collection_template_usage(text)'::text;
  END IF;
  IF cardinality(still_open) > 0 THEN
    RAISE EXCEPTION 'still executable by a client role: %', array_to_string(still_open, ', ');
  END IF;
END $$;
