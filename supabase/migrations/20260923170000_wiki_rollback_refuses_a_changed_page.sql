-- Rolling back a Lexicon revision must not erase what happened to the page after it.
--
-- WHY: `wiki_rollback_revision` wrote the revision's `previous_content` over the
-- page without looking at what the page holds now. Lexicon revisions wait in the
-- review queue as `applied` until the user gets to them, so one page commonly
-- carries several: note A adds a paragraph (R1), note B adds another (R2), the
-- user edits a sentence by hand. Rolling back R1 then restored the page as it
-- was before R1, silently deleting R2's paragraph and the hand edit, while R2
-- stayed in the queue as if it were still on the page. Rolling back a "created"
-- revision deleted the page outright, including everything added since. The
-- bulk path in `review-queue-bulk` did the same with the service role, did not
-- even require the revision to be `applied` (a second rollback rewrote the page
-- again), and walked the revisions in list order, so rolling back R1 then R2
-- left R1's text on the page.
--
-- NOW: the page is locked and a rollback happens only when the page still holds
-- exactly what the revision wrote. Otherwise it refuses with a message saying
-- so; newer revisions are rolled back first (the bulk path now goes newest
-- first), or the page is edited by hand. One body serves both callers:
-- `wiki_rollback_revision_for` is service-only, `wiki_rollback_revision` is the
-- signed-in user's entry point and passes auth.uid().

CREATE OR REPLACE FUNCTION public.wiki_rollback_revision_for(p_user_id uuid, p_revision_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_revision public.wiki_revisions%ROWTYPE;
  v_page public.wiki_pages%ROWTYPE;
  v_short_id text;
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING errcode = '42501';
  END IF;
  IF coalesce(auth.role(), '') <> 'service_role' AND auth.uid() IS DISTINCT FROM p_user_id THEN
    RAISE EXCEPTION 'not authorized' USING errcode = '42501';
  END IF;

  SELECT * INTO v_revision
  FROM public.wiki_revisions
  WHERE id = p_revision_id
    AND user_id = p_user_id
    AND status = 'applied'
    AND change_type IN ('created', 'updated')
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'reviewable wiki revision not found';
  END IF;

  v_short_id := left(v_revision.id::text, 8);

  SELECT * INTO v_page
  FROM public.wiki_pages
  WHERE id = v_revision.wiki_page_id
    AND user_id = p_user_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'wiki page not found';
  END IF;

  IF v_page.content IS DISTINCT FROM v_revision.new_content THEN
    RAISE EXCEPTION 'This Lexicon page changed after this update, so rolling it back would also undo the later changes. Roll back the newer updates first, or edit the page by hand.'
      USING errcode = '40001';
  END IF;

  UPDATE public.wiki_revisions
  SET status = 'rolled_back', rolled_back_at = now()
  WHERE id = v_revision.id
    AND user_id = p_user_id;

  IF v_revision.change_type = 'created' THEN
    DELETE FROM public.wiki_pages
    WHERE id = v_page.id
      AND user_id = p_user_id;
  ELSE
    UPDATE public.wiki_pages
    SET content = COALESCE(v_revision.previous_content, '')
    WHERE id = v_page.id
      AND user_id = p_user_id;

    -- Same as wiki_resync_links, which only accepts a signed-in owner.
    DELETE FROM public.wiki_links WHERE user_id = p_user_id AND source_page_id = v_page.id;
    INSERT INTO public.wiki_links (user_id, source_page_id, target_slug, target_page_id)
    SELECT DISTINCT p_user_id, v_page.id, m.parts[1], target.id
    FROM regexp_matches(COALESCE(v_revision.previous_content, ''), '\[\[([a-z0-9-]+)\]\]', 'g') AS m(parts)
    LEFT JOIN public.wiki_pages target ON target.user_id = p_user_id AND target.slug = m.parts[1];
  END IF;

  INSERT INTO public.wiki_revisions (
    user_id, wiki_page_id, page_slug, page_title, change_type,
    previous_content, new_content, source_note_id, source_revision_id, change_summary, status
  ) VALUES (
    p_user_id,
    CASE WHEN v_revision.change_type = 'created' THEN NULL ELSE v_page.id END,
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

  IF v_revision.change_type = 'created' THEN
    RETURN jsonb_build_object('rolled_back', true, 'deleted_page', true);
  END IF;
  RETURN jsonb_build_object('rolled_back', true, 'deleted_page', false, 'page_id', v_page.id);
END;
$$;

CREATE OR REPLACE FUNCTION public.wiki_rollback_revision(p_revision_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;
  RETURN public.wiki_rollback_revision_for(auth.uid(), p_revision_id);
END;
$$;

REVOKE ALL ON FUNCTION public.wiki_rollback_revision_for(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.wiki_rollback_revision_for(uuid, uuid) FROM anon;
REVOKE ALL ON FUNCTION public.wiki_rollback_revision_for(uuid, uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.wiki_rollback_revision_for(uuid, uuid) TO service_role;
