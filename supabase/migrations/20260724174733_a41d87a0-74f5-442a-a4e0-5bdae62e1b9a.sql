
-- 1. Label normalization
CREATE OR REPLACE FUNCTION public.profile_norm_label(t text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT btrim(regexp_replace(lower(coalesce(t,'')), '[^a-z0-9]+', ' ', 'g'))
$$;

CREATE OR REPLACE FUNCTION public.profile_norm_value(t text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT btrim(regexp_replace(lower(coalesce(t,'')), '\s+', ' ', 'g'))
$$;

-- 2. Canonical label map (observed synonyms only; safe defaults to input)
CREATE OR REPLACE FUNCTION public.profile_canonical_label(t text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT CASE public.profile_norm_label(t)
    WHEN 'moved out at age' THEN 'moved out at age'
    WHEN 'age moved out' THEN 'moved out at age'
    WHEN 'full name japanese' THEN 'japanese name'
    WHEN 'japanese name' THEN 'japanese name'
    WHEN 'full name brazilian' THEN 'brazilian name'
    WHEN 'brazilian name' THEN 'brazilian name'
    WHEN 'vrchat identity' THEN 'vrchat identity'
    WHEN 'vrchat persona' THEN 'vrchat identity'
    WHEN 'vrchat setup' THEN 'vrchat setup'
    WHEN 'vrchat equipment' THEN 'vrchat setup'
    WHEN 'vr equipment' THEN 'vrchat setup'
    WHEN 'vrchat activities' THEN 'vrchat setup'
    WHEN 'vrchat hobbies' THEN 'vrchat setup'
    WHEN 'full body tracking' THEN 'vrchat setup'
    WHEN 'vrchat avatar creators' THEN 'vrchat avatar creators'
    WHEN 'favorite avatar creators' THEN 'vrchat avatar creators'
    WHEN 'health conditions' THEN 'health conditions'
    WHEN 'mental health diagnoses' THEN 'health conditions'
    WHEN 'physical condition' THEN 'health conditions'
    WHEN 'suspected condition' THEN 'health conditions'
    WHEN 'medical history' THEN 'medical history'
    WHEN 'hospitalization history' THEN 'medical history'
    WHEN 'favorite music' THEN 'favorite artists'
    WHEN 'favorite music artists' THEN 'favorite artists'
    WHEN 'favorite musician band' THEN 'favorite artists'
    WHEN 'favorite artists' THEN 'favorite artists'
    WHEN 'favorite food' THEN 'favorite food'
    WHEN 'favorite foods and drinks' THEN 'favorite food'
    WHEN 'favorite fast food' THEN 'favorite food'
    WHEN 'favorite movie' THEN 'favorite movies'
    WHEN 'favorite movies' THEN 'favorite movies'
    WHEN 'comfort movie' THEN 'favorite movies'
    WHEN 'favorite game' THEN 'favorite games'
    WHEN 'favorite games' THEN 'favorite games'
    WHEN 'comfort game' THEN 'favorite games'
    WHEN 'favorite character' THEN 'favorite characters'
    WHEN 'favorite characters' THEN 'favorite characters'
    WHEN 'favorite aesthetics characters' THEN 'favorite characters'
    WHEN 'needs' THEN 'care needs'
    WHEN 'care needs' THEN 'care needs'
    WHEN 'hobbies' THEN 'hobbies'
    WHEN 'favorite hobbies' THEN 'hobbies'
    ELSE public.profile_norm_label(t)
  END
$$;

-- 3. Tokenize list-style values
CREATE OR REPLACE FUNCTION public.profile_tokenize_value(t text)
RETURNS text[] LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT COALESCE(
    ARRAY(
      SELECT DISTINCT btrim(regexp_replace(lower(x), '[^a-z0-9]+', ' ', 'g'))
      FROM regexp_split_to_table(
        coalesce(t, ''),
        '\s*(?:,|;|/|·|•|\||\band\b|&|\+)\s*'
      ) AS x
      WHERE btrim(regexp_replace(lower(x), '[^a-z0-9]+', ' ', 'g')) <> ''
    ),
    ARRAY[]::text[]
  )
$$;

-- 4. BEFORE INSERT dedup trigger
CREATE OR REPLACE FUNCTION public.profile_entries_dedup_before_insert()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_canonical text;
  v_new_tokens text[];
  v_existing record;
  v_existing_tokens text[];
BEGIN
  IF NEW.value IS NULL OR btrim(NEW.value) = '' THEN
    RETURN NEW;
  END IF;

  v_canonical := public.profile_canonical_label(NEW.label);
  v_new_tokens := public.profile_tokenize_value(NEW.value);

  FOR v_existing IN
    SELECT id, label, value
    FROM public.profile_entries
    WHERE user_id = NEW.user_id
      AND contact_id IS NOT DISTINCT FROM NEW.contact_id
      AND public.profile_canonical_label(label) = v_canonical
      AND COALESCE(is_pinned, false) = false
    FOR UPDATE
  LOOP
    v_existing_tokens := public.profile_tokenize_value(v_existing.value);

    -- exact-value duplicate: skip
    IF public.profile_norm_value(v_existing.value) = public.profile_norm_value(NEW.value) THEN
      RETURN NULL;
    END IF;

    -- new tokens subset of existing: skip
    IF array_length(v_new_tokens,1) IS NOT NULL
       AND v_new_tokens <@ v_existing_tokens
       AND array_length(v_new_tokens,1) < array_length(v_existing_tokens,1) THEN
      RETURN NULL;
    END IF;

    -- new tokens superset of existing: fold in place
    IF array_length(v_existing_tokens,1) IS NOT NULL
       AND v_existing_tokens <@ v_new_tokens
       AND array_length(v_existing_tokens,1) < array_length(v_new_tokens,1) THEN
      UPDATE public.profile_entries
         SET value = NEW.value,
             updated_at = now(),
             linked_note_id = COALESCE(NEW.linked_note_id, linked_note_id)
       WHERE id = v_existing.id;
      RETURN NULL;
    END IF;
  END LOOP;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_profile_entries_dedup_before_insert ON public.profile_entries;
CREATE TRIGGER trg_profile_entries_dedup_before_insert
BEFORE INSERT ON public.profile_entries
FOR EACH ROW EXECUTE FUNCTION public.profile_entries_dedup_before_insert();

-- 5. Retroactive cleanup function
CREATE OR REPLACE FUNCTION public.cleanup_profile_duplicates(_user_id uuid, _contact_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_deleted_exact int := 0;
  v_deleted_subset int := 0;
  v_relabeled int := 0;
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
  v_canonical text;
  v_canonical_label text;
BEGIN
  -- Pass 1: within each (canonical_label) group on this contact
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
    -- Pick keeper = row with the most tokens (tie: oldest, which is first in ids)
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

    -- Compare every other row to keeper
    FOR v_row IN
      SELECT id, label, value, created_at FROM public.profile_entries
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
        -- swap: this row is the real superset
        UPDATE public.profile_entries SET value = v_row.value, updated_at = now()
        WHERE id = v_keeper_id;
        DELETE FROM public.profile_entries WHERE id = v_row.id;
        v_keeper_tokens := v_row_tokens;
        v_keeper_value := v_row.value;
        v_deleted_subset := v_deleted_subset + 1;
      ELSE
        -- true conflict: keep both, queue review
        v_conflict_pairs := v_conflict_pairs || jsonb_build_object(
          'other_id', v_row.id,
          'other_label', v_row.label,
          'other_value', v_row.value
        );
      END IF;
    END LOOP;

    -- Ensure keeper carries the canonical label spelling if any of the group used it
    SELECT label INTO v_canonical_label
    FROM public.profile_entries
    WHERE id = v_keeper_id;
    IF public.profile_canonical_label(v_canonical_label) <> public.profile_norm_label(v_canonical_label) THEN
      -- keeper already uses a canonicalized alias; leave as-is
      NULL;
    END IF;

    IF jsonb_array_length(v_conflict_pairs) > 0 THEN
      INSERT INTO public.review_queue (
        user_id, suggestion_type, title, description, payload, status,
        target_entity_type, target_entity_id, confidence_score
      ) VALUES (
        _user_id,
        'merge_profile_entries',
        'Review possible duplicate profile entries',
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
      );
      v_review_created := v_review_created + 1;
    END IF;
  END LOOP;

  SELECT count(*) INTO v_remaining
  FROM public.profile_entries
  WHERE user_id = _user_id AND contact_id IS NOT DISTINCT FROM _contact_id;

  RETURN jsonb_build_object(
    'deleted_exact', v_deleted_exact,
    'deleted_subset', v_deleted_subset,
    'relabeled', v_relabeled,
    'review_created', v_review_created,
    'remaining', v_remaining
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.cleanup_profile_duplicates(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.profile_canonical_label(text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.profile_norm_label(text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.profile_norm_value(text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.profile_tokenize_value(text) TO authenticated, service_role;
