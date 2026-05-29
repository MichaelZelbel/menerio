
-- Rename mcp_visibility → ai_visibility on all entity tables
ALTER TABLE public.notes RENAME COLUMN mcp_visibility TO ai_visibility;
ALTER TABLE public.contacts RENAME COLUMN mcp_visibility TO ai_visibility;
ALTER TABLE public.moments RENAME COLUMN mcp_visibility TO ai_visibility;
ALTER TABLE public.collection_items RENAME COLUMN mcp_visibility TO ai_visibility;
ALTER TABLE public.action_items RENAME COLUMN mcp_visibility TO ai_visibility;

-- Rename CHECK constraints implicitly inherited; rename indexes for clarity
ALTER INDEX IF EXISTS idx_notes_hidden RENAME TO idx_notes_ai_hidden;
ALTER INDEX IF EXISTS idx_contacts_hidden RENAME TO idx_contacts_ai_hidden;
ALTER INDEX IF EXISTS idx_moments_hidden RENAME TO idx_moments_ai_hidden;
ALTER INDEX IF EXISTS idx_collection_items_hidden RENAME TO idx_collection_items_ai_hidden;
ALTER INDEX IF EXISTS idx_action_items_hidden RENAME TO idx_action_items_ai_hidden;

-- Rename preference column
ALTER TABLE public.mcp_preferences RENAME COLUMN hide_sensitive_linked TO hide_sensitive_from_ai;

-- Drop old RPCs (they reference the old column names)
DROP FUNCTION IF EXISTS public.mcp_can_see(uuid, text, uuid);
DROP FUNCTION IF EXISTS public.mcp_hidden_counts(uuid);

-- Recreate as ai_can_see (same logic, new column names)
CREATE OR REPLACE FUNCTION public.ai_can_see(_user_id uuid, _kind text, _id uuid)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
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
              WHERE c.id = ANY (
                SELECT (jsonb_array_elements_text(COALESCE(n.metadata->'matched_people','[]'::jsonb)))::uuid
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
$$;

REVOKE EXECUTE ON FUNCTION public.ai_can_see(uuid, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ai_can_see(uuid, text, uuid) TO authenticated, service_role;

-- Backwards-compat alias so old client code doesn't break mid-deploy
CREATE OR REPLACE FUNCTION public.mcp_can_see(_user_id uuid, _kind text, _id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.ai_can_see(_user_id, _kind, _id);
$$;
REVOKE EXECUTE ON FUNCTION public.mcp_can_see(uuid, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mcp_can_see(uuid, text, uuid) TO authenticated, service_role;

-- Recreate counts function with new column names
CREATE OR REPLACE FUNCTION public.ai_hidden_counts(_user_id uuid)
RETURNS TABLE (notes_hidden int, contacts_hidden int, contacts_sensitive int, moments_hidden int, action_items_hidden int, collection_items_hidden int)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT
    (SELECT count(*)::int FROM public.notes WHERE user_id = _user_id AND ai_visibility = 'hidden'),
    (SELECT count(*)::int FROM public.contacts WHERE user_id = _user_id AND ai_visibility = 'hidden' AND merged_into IS NULL),
    (SELECT count(*)::int FROM public.contacts WHERE user_id = _user_id AND is_sensitive = true AND merged_into IS NULL),
    (SELECT count(*)::int FROM public.moments WHERE user_id = _user_id AND ai_visibility = 'hidden'),
    (SELECT count(*)::int FROM public.action_items WHERE user_id = _user_id AND ai_visibility = 'hidden'),
    (SELECT count(*)::int FROM public.collection_items WHERE user_id = _user_id AND ai_visibility = 'hidden');
$$;
REVOKE EXECUTE ON FUNCTION public.ai_hidden_counts(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ai_hidden_counts(uuid) TO authenticated, service_role;

-- Backwards-compat alias
CREATE OR REPLACE FUNCTION public.mcp_hidden_counts(_user_id uuid)
RETURNS TABLE (notes_hidden int, contacts_hidden int, contacts_sensitive int, moments_hidden int, action_items_hidden int, collection_items_hidden int)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT * FROM public.ai_hidden_counts(_user_id);
$$;
REVOKE EXECUTE ON FUNCTION public.mcp_hidden_counts(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mcp_hidden_counts(uuid) TO authenticated, service_role;
