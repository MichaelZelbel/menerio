CREATE OR REPLACE FUNCTION public.wiki_rollback_revision(p_revision_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_revision public.wiki_revisions%ROWTYPE;
  v_page_id uuid;
  v_short_id text;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  SELECT * INTO v_revision
  FROM public.wiki_revisions
  WHERE id = p_revision_id
    AND user_id = v_user_id
    AND status = 'applied'
    AND change_type IN ('created', 'updated')
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'reviewable wiki revision not found';
  END IF;

  v_short_id := left(v_revision.id::text, 8);

  IF v_revision.change_type = 'created' THEN
    DELETE FROM public.wiki_pages
    WHERE id = v_revision.wiki_page_id
      AND user_id = v_user_id;

    UPDATE public.wiki_revisions
    SET status = 'rolled_back', rolled_back_at = now()
    WHERE id = v_revision.id
      AND user_id = v_user_id;

    INSERT INTO public.wiki_revisions (
      user_id,
      wiki_page_id,
      page_slug,
      page_title,
      change_type,
      previous_content,
      new_content,
      source_note_id,
      source_revision_id,
      change_summary,
      status
    ) VALUES (
      v_user_id,
      NULL,
      v_revision.page_slug,
      v_revision.page_title,
      'rolled_back',
      v_revision.new_content,
      COALESCE(v_revision.previous_content, ''),
      NULL,
      v_revision.id,
      'Rolled back revision ' || v_short_id,
      'applied'
    );

    RETURN jsonb_build_object('rolled_back', true, 'deleted_page', true);
  END IF;

  UPDATE public.wiki_pages
  SET content = COALESCE(v_revision.previous_content, '')
  WHERE id = v_revision.wiki_page_id
    AND user_id = v_user_id
  RETURNING id INTO v_page_id;

  IF v_page_id IS NULL THEN
    RAISE EXCEPTION 'wiki page not found';
  END IF;

  UPDATE public.wiki_revisions
  SET status = 'rolled_back', rolled_back_at = now()
  WHERE id = v_revision.id
    AND user_id = v_user_id;

  INSERT INTO public.wiki_revisions (
    user_id,
    wiki_page_id,
    page_slug,
    page_title,
    change_type,
    previous_content,
    new_content,
    source_note_id,
    source_revision_id,
    change_summary,
    status
  ) VALUES (
    v_user_id,
    v_page_id,
    v_revision.page_slug,
    v_revision.page_title,
    'rolled_back',
    v_revision.new_content,
    COALESCE(v_revision.previous_content, ''),
    NULL,
    v_revision.id,
    'Rolled back revision ' || v_short_id,
    'applied'
  );

  PERFORM public.wiki_resync_links(v_page_id);

  RETURN jsonb_build_object('rolled_back', true, 'deleted_page', false, 'page_id', v_page_id);
END;
$$;