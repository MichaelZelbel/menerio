CREATE OR REPLACE FUNCTION public.note_folder_normalize_path(p_path text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT btrim(regexp_replace(regexp_replace(coalesce(p_path, ''), '^/+|/+$', '', 'g'), '/+', '/', 'g'));
$$;

CREATE OR REPLACE FUNCTION public.create_note_folder(p_path text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_path text := public.note_folder_normalize_path(p_path);
  v_parts text[];
  v_acc text := '';
  v_part text;
  v_created integer := 0;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF v_path = '' THEN RAISE EXCEPTION 'Folder name is required'; END IF;

  v_parts := string_to_array(v_path, '/');
  FOREACH v_part IN ARRAY v_parts LOOP
    IF btrim(v_part) = '' THEN RAISE EXCEPTION 'Folder name is required'; END IF;
    v_acc := CASE WHEN v_acc = '' THEN v_part ELSE v_acc || '/' || v_part END;
    INSERT INTO public.note_folders (user_id, path, name, parent_path)
    VALUES (
      v_user,
      v_acc,
      v_part,
      CASE WHEN position('/' in v_acc) > 0 THEN regexp_replace(v_acc, '/[^/]+$', '') ELSE '' END
    )
    ON CONFLICT (user_id, path) DO NOTHING;
    IF FOUND THEN v_created := v_created + 1; END IF;
  END LOOP;

  RETURN jsonb_build_object('path', v_path, 'created', v_created);
END;
$$;

CREATE OR REPLACE FUNCTION public.rename_note_folder(p_old_path text, p_new_path text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_old text := public.note_folder_normalize_path(p_old_path);
  v_new text := public.note_folder_normalize_path(p_new_path);
  v_like text;
  v_folders integer := 0;
  v_notes integer := 0;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF v_old = '' OR v_new = '' THEN RAISE EXCEPTION 'Folder path is required'; END IF;
  IF v_old = v_new THEN RETURN jsonb_build_object('path', v_new, 'folders', 0, 'notes', 0); END IF;
  IF v_new LIKE v_old || '/%' THEN
    RAISE EXCEPTION 'Cannot move a folder into itself';
  END IF;

  IF EXISTS (SELECT 1 FROM public.note_folders WHERE user_id = v_user AND path = v_new) THEN
    RAISE EXCEPTION 'A folder "%" already exists', v_new;
  END IF;

  v_like := replace(replace(replace(v_old, '\', '\\'), '%', '\%'), '_', '\_') || '/%';

  UPDATE public.note_folders f
  SET path = v_new || substring(f.path from length(v_old) + 1),
      name = regexp_replace(v_new || substring(f.path from length(v_old) + 1), '^.*/', ''),
      parent_path = CASE
        WHEN position('/' in (v_new || substring(f.path from length(v_old) + 1))) > 0
          THEN regexp_replace(v_new || substring(f.path from length(v_old) + 1), '/[^/]+$', '')
        ELSE '' END
  WHERE f.user_id = v_user
    AND (f.path = v_old OR f.path LIKE v_like);
  GET DIAGNOSTICS v_folders = ROW_COUNT;

  UPDATE public.notes n
  SET folder_path = v_new || substring(n.folder_path from length(v_old) + 1)
  WHERE n.user_id = v_user
    AND (n.folder_path = v_old OR n.folder_path LIKE v_like);
  GET DIAGNOSTICS v_notes = ROW_COUNT;

  IF v_folders = 0 THEN
    PERFORM public.create_note_folder(v_new);
    v_folders := 1;
  END IF;

  RETURN jsonb_build_object('path', v_new, 'folders', v_folders, 'notes', v_notes);
END;
$$;

CREATE OR REPLACE FUNCTION public.move_note_folder(p_source_path text, p_target_parent_path text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_source text := public.note_folder_normalize_path(p_source_path);
  v_parent text := public.note_folder_normalize_path(p_target_parent_path);
  v_name text;
  v_new text;
BEGIN
  IF v_source = '' THEN RAISE EXCEPTION 'Folder path is required'; END IF;
  IF v_parent = v_source OR v_parent LIKE v_source || '/%' THEN
    RAISE EXCEPTION 'Cannot move a folder into itself';
  END IF;
  v_name := regexp_replace(v_source, '^.*/', '');
  v_new := CASE WHEN v_parent = '' THEN v_name ELSE v_parent || '/' || v_name END;
  IF v_new = v_source THEN
    RETURN jsonb_build_object('path', v_source, 'folders', 0, 'notes', 0);
  END IF;
  RETURN public.rename_note_folder(v_source, v_new);
END;
$$;

CREATE OR REPLACE FUNCTION public.reconcile_note_folders()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_path text;
  v_created integer := 0;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  FOR v_path IN
    SELECT DISTINCT public.note_folder_normalize_path(n.folder_path)
    FROM public.notes n
    WHERE n.user_id = v_user
      AND coalesce(n.is_trashed, false) = false
      AND public.note_folder_normalize_path(n.folder_path) <> ''
  LOOP
    IF NOT EXISTS (SELECT 1 FROM public.note_folders f WHERE f.user_id = v_user AND f.path = v_path) THEN
      PERFORM public.create_note_folder(v_path);
      v_created := v_created + 1;
    END IF;
  END LOOP;
  RETURN jsonb_build_object('created', v_created);
END;
$$;

GRANT EXECUTE ON FUNCTION public.note_folder_normalize_path(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_note_folder(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rename_note_folder(text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.move_note_folder(text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reconcile_note_folders() TO authenticated;