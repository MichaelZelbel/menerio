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

  IF NOT p_force
     AND v_page.last_members_synced_at IS NOT NULL
     AND v_page.last_members_synced_at > now() - interval '30 seconds'
     AND v_updated_content IS NOT DISTINCT FROM v_page.content THEN
    RETURN jsonb_build_object('synced', false, 'reason', 'coalesced_no_change');
  END IF;

  UPDATE public.wiki_pages
  SET content = v_updated_content,
      last_members_synced_at = now()
  WHERE id = v_page.id;

  DELETE FROM public.wiki_links
  WHERE source_page_id = v_page.id;

  INSERT INTO public.wiki_links (user_id, source_page_id, target_slug, target_page_id)
  SELECT
    v_page.user_id,
    v_page.id,
    matches.target_slug,
    target.id
  FROM regexp_matches(COALESCE(v_updated_content, ''), '\[\[([a-z0-9-]+)\]\]', 'g') AS match(slug_parts)
  CROSS JOIN LATERAL (SELECT match.slug_parts[1] AS target_slug) AS matches
  LEFT JOIN public.wiki_pages target
    ON target.user_id = v_page.user_id
   AND target.slug = matches.target_slug;

  RETURN jsonb_build_object('synced', true, 'page_id', v_page.id);
END;
$$;

REVOKE ALL ON FUNCTION public.sync_group_wiki_members(uuid, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sync_group_wiki_members(uuid, boolean) FROM authenticated;
REVOKE ALL ON FUNCTION public.sync_group_wiki_members(uuid, boolean) FROM anon;