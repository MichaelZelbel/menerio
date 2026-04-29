ALTER TABLE public.wiki_pages
ADD COLUMN IF NOT EXISTS last_members_synced_at timestamptz;

CREATE OR REPLACE FUNCTION public.replace_group_members_section(p_content text, p_members_section text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  v_normalized text := rtrim(COALESCE(p_content, ''), E' \n\r\t');
  v_section text := '## Members' || E'\n' || rtrim(COALESCE(p_members_section, '_No members yet._'), E' \n\r\t') || E'\n';
BEGIN
  IF v_normalized ~ '(^|\n)## Members\n' THEN
    RETURN rtrim(regexp_replace(v_normalized, '(^|\n)## Members\n[\s\S]*?(?=\n##\s|$)', E'\1' || v_section), E' \n\r\t') || E'\n';
  END IF;

  RETURN rtrim(v_normalized || E'\n\n' || v_section, E' \n\r\t') || E'\n';
END;
$$;

CREATE OR REPLACE FUNCTION public.sync_group_wiki_members(p_group_id uuid, p_force boolean DEFAULT false)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_group record;
  v_page record;
  v_members_section text;
  v_updated_content text;
BEGIN
  IF p_group_id IS NULL THEN
    RAISE EXCEPTION 'group_id is required';
  END IF;

  SELECT id, user_id, slug
  INTO v_group
  FROM public.contact_groups
  WHERE id = p_group_id
    AND (auth.uid() IS NULL OR user_id = auth.uid());

  IF v_group.id IS NULL THEN
    RAISE EXCEPTION 'group not found';
  END IF;

  SELECT id, user_id, content, last_members_synced_at
  INTO v_page
  FROM public.wiki_pages
  WHERE user_id = v_group.user_id
    AND page_type = 'group'
    AND slug = 'group-' || v_group.slug
  FOR UPDATE;

  IF v_page.id IS NULL THEN
    RETURN jsonb_build_object('synced', false, 'reason', 'wiki_page_missing');
  END IF;

  IF NOT p_force
     AND v_page.last_members_synced_at IS NOT NULL
     AND v_page.last_members_synced_at > now() - interval '30 seconds' THEN
    RETURN jsonb_build_object('synced', false, 'reason', 'coalesced');
  END IF;

  SELECT COALESCE(
    string_agg(
      '- [[' || COALESCE(person_pages.slug, regexp_replace(regexp_replace(lower(trim(c.name)), '[^a-z0-9]+', '-', 'g'), '^-+|-+$', '', 'g'), 'person') || ']]' ||
      CASE WHEN m.status IS NULL OR m.status = '' THEN '' ELSE ' — ' || replace(m.status, '_', ' ') END,
      E'\n'
      ORDER BY m.position ASC, c.name ASC
    ),
    '_No members yet._'
  )
  INTO v_members_section
  FROM public.contact_group_memberships m
  JOIN public.contacts c ON c.id = m.person_id AND c.user_id = m.user_id
  LEFT JOIN public.wiki_pages person_pages
    ON person_pages.user_id = m.user_id
   AND person_pages.page_type = 'person'
   AND person_pages.title = c.name
  WHERE m.group_id = p_group_id
    AND m.user_id = v_group.user_id
    AND m.archived_at IS NULL
    AND c.name IS NOT NULL;

  v_updated_content := public.replace_group_members_section(v_page.content, v_members_section);

  UPDATE public.wiki_pages
  SET content = v_updated_content,
      last_members_synced_at = now()
  WHERE id = v_page.id;

  PERFORM public.wiki_resync_links(v_page.id);

  RETURN jsonb_build_object('synced', true, 'page_id', v_page.id);
END;
$$;

CREATE OR REPLACE FUNCTION public.handle_group_membership_wiki_sync()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_group_id uuid;
BEGIN
  v_group_id := COALESCE(NEW.group_id, OLD.group_id);

  IF v_group_id IS NOT NULL THEN
    PERFORM public.sync_group_wiki_members(v_group_id, false);
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS sync_group_wiki_members_after_insert ON public.contact_group_memberships;
DROP TRIGGER IF EXISTS sync_group_wiki_members_after_update ON public.contact_group_memberships;
DROP TRIGGER IF EXISTS sync_group_wiki_members_after_delete ON public.contact_group_memberships;

CREATE TRIGGER sync_group_wiki_members_after_insert
AFTER INSERT ON public.contact_group_memberships
FOR EACH ROW
EXECUTE FUNCTION public.handle_group_membership_wiki_sync();

CREATE TRIGGER sync_group_wiki_members_after_update
AFTER UPDATE OF person_id, status, position, archived_at ON public.contact_group_memberships
FOR EACH ROW
WHEN (
  NEW.person_id IS DISTINCT FROM OLD.person_id OR
  NEW.status IS DISTINCT FROM OLD.status OR
  NEW.position IS DISTINCT FROM OLD.position OR
  NEW.archived_at IS DISTINCT FROM OLD.archived_at
)
EXECUTE FUNCTION public.handle_group_membership_wiki_sync();

CREATE TRIGGER sync_group_wiki_members_after_delete
AFTER DELETE ON public.contact_group_memberships
FOR EACH ROW
EXECUTE FUNCTION public.handle_group_membership_wiki_sync();

REVOKE ALL ON FUNCTION public.replace_group_members_section(text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sync_group_wiki_members(uuid, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.handle_group_membership_wiki_sync() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.sync_group_wiki_members(uuid, boolean) TO authenticated;