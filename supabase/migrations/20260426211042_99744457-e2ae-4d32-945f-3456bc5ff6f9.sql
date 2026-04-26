CREATE OR REPLACE FUNCTION public.wiki_apply_ingest(
  p_note_id uuid,
  p_actions jsonb,
  p_source_links jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_action jsonb;
  v_source_link jsonb;
  v_page_slug text;
  v_page_id uuid;
  v_existing_title text;
  v_previous_content text;
  v_new_content text;
  v_action_count integer := 0;
  v_affected_page_ids uuid[] := ARRAY[]::uuid[];
  v_slugs text[];
  v_slug text;
  v_revision_type text;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  IF p_actions IS NULL OR jsonb_typeof(p_actions) <> 'array' THEN
    RAISE EXCEPTION 'actions must be an array';
  END IF;

  IF p_source_links IS NULL OR jsonb_typeof(p_source_links) <> 'array' THEN
    RAISE EXCEPTION 'source_links must be an array';
  END IF;

  PERFORM 1 FROM public.notes WHERE id = p_note_id AND user_id = v_user_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'note not found';
  END IF;

  FOR v_action IN SELECT * FROM jsonb_array_elements(p_actions)
  LOOP
    v_page_slug := lower(trim(v_action->>'slug'));
    IF v_page_slug IS NULL OR v_page_slug = '' THEN
      CONTINUE;
    END IF;

    -- Prevent parallel ingest calls from racing to create the same user/slug pair.
    PERFORM pg_advisory_xact_lock(hashtextextended(v_user_id::text || ':' || v_page_slug, 0));

    v_page_id := NULL;
    v_existing_title := NULL;
    v_previous_content := NULL;
    v_new_content := NULL;
    v_revision_type := NULL;

    SELECT id, title, content INTO v_page_id, v_existing_title, v_previous_content
    FROM public.wiki_pages
    WHERE user_id = v_user_id AND slug = v_page_slug
    FOR UPDATE;

    IF v_action->>'op' = 'create' AND v_page_id IS NULL THEN
      v_new_content := COALESCE(v_action->>'content', '');
      v_revision_type := 'created';

      INSERT INTO public.wiki_pages (user_id, slug, title, page_type, summary, content)
      VALUES (
        v_user_id,
        v_page_slug,
        COALESCE(NULLIF(v_action->>'title', ''), v_page_slug),
        COALESCE(NULLIF(v_action->>'page_type', ''), 'concept'),
        NULLIF(v_action->>'summary', ''),
        v_new_content
      )
      RETURNING id, title INTO v_page_id, v_existing_title;
    ELSE
      v_new_content := COALESCE(v_action->>'patch', v_action->>'content', v_previous_content, '');
      v_revision_type := 'updated';

      IF v_page_id IS NULL THEN
        INSERT INTO public.wiki_pages (user_id, slug, title, page_type, summary, content)
        VALUES (
          v_user_id,
          v_page_slug,
          COALESCE(NULLIF(v_action->>'title', ''), v_page_slug),
          COALESCE(NULLIF(v_action->>'page_type', ''), 'concept'),
          NULLIF(v_action->>'summary', ''),
          v_new_content
        )
        RETURNING id, title INTO v_page_id, v_existing_title;
        v_revision_type := 'created';
      ELSE
        UPDATE public.wiki_pages
        SET
          title = COALESCE(NULLIF(v_action->>'title', ''), title),
          page_type = COALESCE(NULLIF(v_action->>'page_type', ''), page_type),
          summary = COALESCE(NULLIF(v_action->>'summary', ''), summary),
          content = v_new_content
        WHERE id = v_page_id AND user_id = v_user_id
        RETURNING title INTO v_existing_title;
      END IF;
    END IF;

    INSERT INTO public.wiki_revisions (
      user_id, wiki_page_id, page_slug, page_title, change_type,
      previous_content, new_content, source_note_id, change_summary, status
    )
    VALUES (
      v_user_id,
      v_page_id,
      v_page_slug,
      COALESCE(NULLIF(v_action->>'title', ''), v_existing_title, v_page_slug),
      v_revision_type,
      CASE WHEN v_revision_type = 'created' THEN NULL ELSE v_previous_content END,
      v_new_content,
      p_note_id,
      COALESCE(NULLIF(v_action->>'change_summary', ''), CASE WHEN v_revision_type = 'created' THEN 'Created from note' ELSE 'Updated from note' END),
      'applied'
    );

    v_action_count := v_action_count + 1;
    v_affected_page_ids := array_append(v_affected_page_ids, v_page_id);
    PERFORM public.wiki_resync_links(v_page_id);
  END LOOP;

  FOR v_source_link IN SELECT * FROM jsonb_array_elements(p_source_links)
  LOOP
    IF COALESCE(v_source_link->>'note_id', '') <> p_note_id::text THEN
      CONTINUE;
    END IF;

    SELECT array_agg(value::text) INTO v_slugs
    FROM jsonb_array_elements_text(COALESCE(v_source_link->'page_slugs', '[]'::jsonb)) AS value;

    IF v_slugs IS NULL THEN
      CONTINUE;
    END IF;

    FOREACH v_slug IN ARRAY v_slugs
    LOOP
      SELECT id INTO v_page_id
      FROM public.wiki_pages
      WHERE user_id = v_user_id AND slug = v_slug;

      IF v_page_id IS NOT NULL THEN
        INSERT INTO public.wiki_page_sources (user_id, wiki_page_id, note_id)
        VALUES (v_user_id, v_page_id, p_note_id)
        ON CONFLICT (wiki_page_id, note_id) DO NOTHING;
        v_affected_page_ids := array_append(v_affected_page_ids, v_page_id);
      END IF;
    END LOOP;
  END LOOP;

  UPDATE public.wiki_pages wp
  SET source_count = counts.source_count
  FROM (
    SELECT wiki_page_id, count(*)::integer AS source_count
    FROM public.wiki_page_sources
    WHERE user_id = v_user_id
      AND wiki_page_id = ANY(v_affected_page_ids)
    GROUP BY wiki_page_id
  ) counts
  WHERE wp.id = counts.wiki_page_id
    AND wp.user_id = v_user_id;

  RETURN jsonb_build_object(
    'action_count', v_action_count,
    'affected_page_count', COALESCE(array_length(ARRAY(SELECT DISTINCT unnest(v_affected_page_ids)), 1), 0)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.wiki_apply_ingest(uuid, jsonb, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.wiki_apply_ingest(uuid, jsonb, jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.wiki_apply_ingest(uuid, jsonb, jsonb) TO authenticated;