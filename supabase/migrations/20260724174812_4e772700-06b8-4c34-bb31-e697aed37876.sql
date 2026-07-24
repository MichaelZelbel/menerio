
CREATE OR REPLACE FUNCTION public.cleanup_profile_duplicates(_user_id uuid, _contact_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_deleted_exact int := 0;
  v_deleted_subset int := 0;
  v_review_created int := 0;
  v_remaining int;
  v_group record;
  v_row record;
  v_keeper_id uuid;
  v_keeper_tokens text[];
  v_keeper_value text;
  v_keeper_len int;
  v_row_tokens text[];
  v_row_len int;
  v_conflict_pairs jsonb;
  v_contact_name text;
BEGIN
  SELECT name INTO v_contact_name FROM public.contacts WHERE id = _contact_id;

  FOR v_group IN
    SELECT public.profile_canonical_label(label) AS canonical,
           array_agg(id ORDER BY created_at ASC) AS ids
    FROM public.profile_entries
    WHERE user_id = _user_id
      AND contact_id IS NOT DISTINCT FROM _contact_id
      AND COALESCE(is_pinned, false) = false
    GROUP BY public.profile_canonical_label(label)
    HAVING count(*) > 1
  LOOP
    v_keeper_id := NULL;
    v_keeper_len := -1;
    v_keeper_tokens := ARRAY[]::text[];
    v_keeper_value := NULL;

    FOR v_row IN
      SELECT id, label, value FROM public.profile_entries
      WHERE id = ANY(v_group.ids)
      ORDER BY created_at ASC
    LOOP
      v_row_tokens := public.profile_tokenize_value(v_row.value);
      v_row_len := COALESCE(array_length(v_row_tokens,1), 0);
      IF v_row_len > v_keeper_len THEN
        v_keeper_id := v_row.id;
        v_keeper_len := v_row_len;
        v_keeper_tokens := v_row_tokens;
        v_keeper_value := v_row.value;
      END IF;
    END LOOP;

    v_conflict_pairs := '[]'::jsonb;

    FOR v_row IN
      SELECT id, label, value FROM public.profile_entries
      WHERE id = ANY(v_group.ids) AND id <> v_keeper_id
      ORDER BY created_at ASC
    LOOP
      v_row_tokens := public.profile_tokenize_value(v_row.value);

      IF public.profile_norm_value(v_row.value) = public.profile_norm_value(v_keeper_value) THEN
        DELETE FROM public.profile_entries WHERE id = v_row.id;
        v_deleted_exact := v_deleted_exact + 1;
      ELSIF array_length(v_row_tokens,1) IS NOT NULL
            AND v_row_tokens <@ v_keeper_tokens THEN
        DELETE FROM public.profile_entries WHERE id = v_row.id;
        v_deleted_subset := v_deleted_subset + 1;
      ELSIF array_length(v_keeper_tokens,1) IS NOT NULL
            AND v_keeper_tokens <@ v_row_tokens THEN
        UPDATE public.profile_entries SET value = v_row.value, updated_at = now()
        WHERE id = v_keeper_id;
        DELETE FROM public.profile_entries WHERE id = v_row.id;
        v_keeper_tokens := v_row_tokens;
        v_keeper_value := v_row.value;
        v_deleted_subset := v_deleted_subset + 1;
      ELSE
        v_conflict_pairs := v_conflict_pairs || jsonb_build_object(
          'other_id', v_row.id,
          'other_label', v_row.label,
          'other_value', v_row.value
        );
      END IF;
    END LOOP;

    IF jsonb_array_length(v_conflict_pairs) > 0 THEN
      INSERT INTO public.review_queue (
        user_id, suggestion_type, title, description, payload, status,
        target_entity_type, target_entity_id, confidence_score
      ) VALUES (
        _user_id,
        'merge_profile_entries',
        'Review duplicate "' || v_group.canonical || '" entries' ||
          CASE WHEN v_contact_name IS NULL THEN '' ELSE ' for ' || v_contact_name END,
        'Same category "' || v_group.canonical || '" contains conflicting values that could not be safely merged automatically.',
        jsonb_build_object(
          'contact_id', _contact_id,
          'canonical_label', v_group.canonical,
          'keeper_id', v_keeper_id,
          'keeper_value', v_keeper_value,
          'conflicts', v_conflict_pairs
        ),
        'pending',
        'contact',
        _contact_id,
        0.6
      )
      ON CONFLICT DO NOTHING;
      v_review_created := v_review_created + 1;
    END IF;
  END LOOP;

  SELECT count(*) INTO v_remaining
  FROM public.profile_entries
  WHERE user_id = _user_id AND contact_id IS NOT DISTINCT FROM _contact_id;

  RETURN jsonb_build_object(
    'deleted_exact', v_deleted_exact,
    'deleted_subset', v_deleted_subset,
    'review_created', v_review_created,
    'remaining', v_remaining
  );
END;
$$;
