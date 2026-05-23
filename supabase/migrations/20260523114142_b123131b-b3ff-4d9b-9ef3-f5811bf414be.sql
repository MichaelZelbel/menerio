
ALTER TABLE public.notes ADD COLUMN mcp_visibility text NOT NULL DEFAULT 'visible' CHECK (mcp_visibility IN ('visible','hidden'));
ALTER TABLE public.contacts ADD COLUMN mcp_visibility text NOT NULL DEFAULT 'visible' CHECK (mcp_visibility IN ('visible','hidden'));
ALTER TABLE public.contacts ADD COLUMN is_sensitive boolean NOT NULL DEFAULT false;
ALTER TABLE public.moments ADD COLUMN mcp_visibility text NOT NULL DEFAULT 'visible' CHECK (mcp_visibility IN ('visible','hidden'));
ALTER TABLE public.collection_items ADD COLUMN mcp_visibility text NOT NULL DEFAULT 'visible' CHECK (mcp_visibility IN ('visible','hidden'));
ALTER TABLE public.action_items ADD COLUMN mcp_visibility text NOT NULL DEFAULT 'visible' CHECK (mcp_visibility IN ('visible','hidden'));

CREATE INDEX IF NOT EXISTS idx_notes_hidden ON public.notes (user_id) WHERE mcp_visibility = 'hidden';
CREATE INDEX IF NOT EXISTS idx_contacts_hidden ON public.contacts (user_id) WHERE mcp_visibility = 'hidden';
CREATE INDEX IF NOT EXISTS idx_contacts_sensitive ON public.contacts (user_id) WHERE is_sensitive = true;
CREATE INDEX IF NOT EXISTS idx_moments_hidden ON public.moments (user_id) WHERE mcp_visibility = 'hidden';
CREATE INDEX IF NOT EXISTS idx_collection_items_hidden ON public.collection_items (user_id) WHERE mcp_visibility = 'hidden';
CREATE INDEX IF NOT EXISTS idx_action_items_hidden ON public.action_items (user_id) WHERE mcp_visibility = 'hidden';

CREATE TABLE public.mcp_preferences (
  user_id uuid PRIMARY KEY DEFAULT auth.uid(),
  default_notes_visible boolean NOT NULL DEFAULT true,
  default_people_visible boolean NOT NULL DEFAULT true,
  hide_sensitive_linked boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.mcp_preferences ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own mcp preferences"
  ON public.mcp_preferences FOR ALL TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

CREATE TRIGGER handle_mcp_preferences_updated_at
BEFORE UPDATE ON public.mcp_preferences
FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

CREATE OR REPLACE FUNCTION public.mcp_sensitive_person_ids(_user_id uuid)
RETURNS SETOF uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT id FROM public.contacts
  WHERE user_id = _user_id AND is_sensitive = true AND merged_into IS NULL;
$$;

CREATE OR REPLACE FUNCTION public.mcp_can_see(_user_id uuid, _kind text, _id uuid)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_visible boolean := false;
  v_hide_sensitive boolean := true;
BEGIN
  SELECT COALESCE(hide_sensitive_linked, true) INTO v_hide_sensitive
  FROM public.mcp_preferences WHERE user_id = _user_id;
  IF v_hide_sensitive IS NULL THEN v_hide_sensitive := true; END IF;

  IF _kind = 'note' THEN
    SELECT (n.mcp_visibility = 'visible'
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
    SELECT (mcp_visibility = 'visible') INTO v_visible
    FROM public.contacts WHERE id = _id AND user_id = _user_id;

  ELSIF _kind = 'moment' THEN
    SELECT (m.mcp_visibility = 'visible'
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
    SELECT (a.mcp_visibility = 'visible'
            AND (NOT v_hide_sensitive OR a.contact_id IS NULL OR NOT EXISTS (
              SELECT 1 FROM public.contacts c WHERE c.id = a.contact_id AND c.is_sensitive = true AND c.user_id = _user_id
            )))
    INTO v_visible
    FROM public.action_items a WHERE a.id = _id AND a.user_id = _user_id;

  ELSIF _kind = 'collection_item' THEN
    SELECT (mcp_visibility = 'visible') INTO v_visible
    FROM public.collection_items WHERE id = _id AND user_id = _user_id;
  END IF;

  RETURN COALESCE(v_visible, false);
END;
$$;

CREATE OR REPLACE FUNCTION public.mcp_hidden_counts(_user_id uuid)
RETURNS TABLE (notes_hidden int, contacts_hidden int, contacts_sensitive int, moments_hidden int, action_items_hidden int, collection_items_hidden int)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT
    (SELECT count(*)::int FROM public.notes WHERE user_id = _user_id AND mcp_visibility = 'hidden'),
    (SELECT count(*)::int FROM public.contacts WHERE user_id = _user_id AND mcp_visibility = 'hidden' AND merged_into IS NULL),
    (SELECT count(*)::int FROM public.contacts WHERE user_id = _user_id AND is_sensitive = true AND merged_into IS NULL),
    (SELECT count(*)::int FROM public.moments WHERE user_id = _user_id AND mcp_visibility = 'hidden'),
    (SELECT count(*)::int FROM public.action_items WHERE user_id = _user_id AND mcp_visibility = 'hidden'),
    (SELECT count(*)::int FROM public.collection_items WHERE user_id = _user_id AND mcp_visibility = 'hidden');
$$;
