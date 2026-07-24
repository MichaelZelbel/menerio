CREATE OR REPLACE FUNCTION public.profile_fact_token_key(t text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  WITH cleaned AS (
    SELECT lower(coalesce(t, '')) AS s
  ), normalized AS (
    SELECT regexp_replace(
             regexp_replace(
               regexp_replace(
                 regexp_replace(
                   regexp_replace(
                     regexp_replace(s, '[''’‘´`]', '', 'g'),
                     '[^[:alnum:]]+', ' ', 'g'
                   ),
                   '\bmcdonald s\b', 'mcdonalds', 'g'
                 ),
                 '\bdomino s\b', 'dominos', 'g'
               ),
               '\b(specifically|especially|favorite|favourite|anything|something|things|thing|also|all|chapters?)\b', ' ', 'g'
             ),
             '\b(from|in|at|of|to|for|with|as|the|a|an)\b', ' ', 'g'
           ) AS s
    FROM cleaned
  )
  SELECT btrim(regexp_replace(s, '\s+', ' ', 'g'))
  FROM normalized;
$$;

CREATE OR REPLACE FUNCTION public.profile_token_key_contains(superset_key text, subset_key text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE
    WHEN coalesce(subset_key, '') = '' OR coalesce(superset_key, '') = '' THEN false
    WHEN superset_key = subset_key THEN true
    WHEN length(subset_key) < 3 THEN false
    ELSE (' ' || superset_key || ' ') LIKE ('% ' || subset_key || ' %')
  END;
$$;

CREATE OR REPLACE FUNCTION public.profile_token_keys_overlap(a text, b text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT public.profile_token_key_contains(a, b) OR public.profile_token_key_contains(b, a);
$$;

CREATE OR REPLACE FUNCTION public.profile_tokenize_value(t text)
RETURNS text[]
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT COALESCE(
    ARRAY(
      SELECT DISTINCT public.profile_fact_token_key(x)
      FROM regexp_split_to_table(coalesce(t, ''), '\s*(?:[,;|•·]|\n+)\s*') AS x
      WHERE public.profile_fact_token_key(x) <> ''
    ),
    ARRAY[]::text[]
  );
$$;

CREATE OR REPLACE FUNCTION public.profile_dedup_value_tokens(_label text, _value text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  v_part text;
  v_key text;
  v_kept_values text[] := ARRAY[]::text[];
  v_kept_keys text[] := ARRAY[]::text[];
  v_next_values text[];
  v_next_keys text[];
  v_i int;
  v_skip boolean;
  v_replaced boolean;
BEGIN
  FOR v_part IN
    SELECT btrim(x)
    FROM regexp_split_to_table(coalesce(_value, ''), '\s*(?:[,;|•·]|\n+)\s*') AS x
  LOOP
    v_part := btrim(coalesce(v_part, ''));
    v_key := public.profile_fact_token_key(v_part);
    IF v_part = '' OR v_key = '' THEN
      CONTINUE;
    END IF;

    v_skip := false;
    IF cardinality(v_kept_keys) > 0 THEN
      FOR v_i IN 1..cardinality(v_kept_keys) LOOP
        IF public.profile_token_key_contains(v_kept_keys[v_i], v_key) THEN
          v_skip := true;
          EXIT;
        END IF;
      END LOOP;
    END IF;
    IF v_skip THEN
      CONTINUE;
    END IF;

    v_next_values := ARRAY[]::text[];
    v_next_keys := ARRAY[]::text[];
    v_replaced := false;

    IF cardinality(v_kept_keys) > 0 THEN
      FOR v_i IN 1..cardinality(v_kept_keys) LOOP
        IF public.profile_token_key_contains(v_key, v_kept_keys[v_i]) THEN
          IF NOT v_replaced THEN
            v_next_values := array_append(v_next_values, v_part);
            v_next_keys := array_append(v_next_keys, v_key);
            v_replaced := true;
          END IF;
        ELSE
          v_next_values := array_append(v_next_values, v_kept_values[v_i]);
          v_next_keys := array_append(v_next_keys, v_kept_keys[v_i]);
        END IF;
      END LOOP;
    END IF;

    IF v_replaced THEN
      v_kept_values := v_next_values;
      v_kept_keys := v_next_keys;
    ELSE
      v_kept_values := array_append(v_kept_values, v_part);
      v_kept_keys := array_append(v_kept_keys, v_key);
    END IF;
  END LOOP;

  RETURN COALESCE(array_to_string(v_kept_values, ', '), '');
END;
$$;

CREATE OR REPLACE FUNCTION public.profile_dedup_value_against_keys(_value text, _seen_keys text[])
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  v_part text;
  v_key text;
  v_seen text[] := COALESCE(_seen_keys, ARRAY[]::text[]);
  v_kept_values text[] := ARRAY[]::text[];
  v_seen_key text;
  v_is_duplicate boolean;
BEGIN
  FOR v_part IN
    SELECT btrim(x)
    FROM regexp_split_to_table(public.profile_dedup_value_tokens('', coalesce(_value, '')), '\s*(?:[,;|•·]|\n+)\s*') AS x
  LOOP
    v_part := btrim(coalesce(v_part, ''));
    v_key := public.profile_fact_token_key(v_part);
    IF v_part = '' OR v_key = '' THEN
      CONTINUE;
    END IF;

    v_is_duplicate := false;
    FOREACH v_seen_key IN ARRAY v_seen LOOP
      IF public.profile_token_keys_overlap(v_seen_key, v_key) THEN
        v_is_duplicate := true;
        EXIT;
      END IF;
    END LOOP;

    IF NOT v_is_duplicate THEN
      v_kept_values := array_append(v_kept_values, v_part);
      v_seen := array_append(v_seen, v_key);
    END IF;
  END LOOP;

  RETURN COALESCE(array_to_string(v_kept_values, ', '), '');
END;
$$;

CREATE OR REPLACE FUNCTION public.profile_existing_token_keys(
  _user_id uuid,
  _contact_id uuid,
  _label text,
  _exclude_id uuid DEFAULT NULL
)
RETURNS text[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    ARRAY(
      SELECT DISTINCT k
      FROM public.profile_entries pe
      CROSS JOIN LATERAL unnest(public.profile_tokenize_value(pe.value)) AS k
      WHERE pe.user_id = _user_id
        AND pe.contact_id IS NOT DISTINCT FROM _contact_id
        AND pe.id IS DISTINCT FROM _exclude_id
        AND public.profile_fact_label_key(pe.label) = public.profile_fact_label_key(_label)
        AND k <> ''
    ),
    ARRAY[]::text[]
  );
$$;

CREATE OR REPLACE FUNCTION public.profile_entries_prevent_duplicate_fact()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_label_key text;
  v_value_key text;
  v_existing record;
  v_existing_keys text[];
BEGIN
  IF NEW.value IS NULL OR btrim(NEW.value) = '' THEN
    RETURN NEW;
  END IF;

  NEW.value := public.profile_dedup_value_tokens(NEW.label, NEW.value);

  IF TG_OP = 'INSERT' THEN
    v_existing_keys := public.profile_existing_token_keys(NEW.user_id, NEW.contact_id, NEW.label, NEW.id);
    NEW.value := public.profile_dedup_value_against_keys(NEW.value, v_existing_keys);
  END IF;

  IF NEW.value IS NULL OR btrim(NEW.value) = '' THEN
    RETURN NULL;
  END IF;

  v_label_key := public.profile_fact_label_key(NEW.label);
  v_value_key := public.profile_fact_text_key(NEW.value);

  IF v_label_key = '' OR v_value_key = '' THEN
    RETURN NEW;
  END IF;

  SELECT id, label, value, linked_note_id
    INTO v_existing
    FROM public.profile_entries
   WHERE user_id = NEW.user_id
     AND contact_id IS NOT DISTINCT FROM NEW.contact_id
     AND id IS DISTINCT FROM NEW.id
     AND public.profile_fact_label_key(label) = v_label_key
     AND public.profile_fact_text_key(value) = v_value_key
   ORDER BY COALESCE(is_pinned, false) DESC, created_at ASC, id ASC
   LIMIT 1
   FOR UPDATE;

  IF FOUND THEN
    IF TG_OP = 'INSERT' THEN
      UPDATE public.profile_entries
         SET linked_note_id = COALESCE(public.profile_entries.linked_note_id, NEW.linked_note_id),
             updated_at = now()
       WHERE id = v_existing.id;
    END IF;
    RETURN NULL;
  END IF;

  SELECT id, label, value, linked_note_id
    INTO v_existing
    FROM public.profile_entries
   WHERE user_id = NEW.user_id
     AND contact_id IS NOT DISTINCT FROM NEW.contact_id
     AND id IS DISTINCT FROM NEW.id
     AND public.profile_fact_label_key(label) = v_label_key
     AND public.profile_value_contains_fact(value, NEW.value)
   ORDER BY length(public.profile_fact_text_key(value)) DESC,
            COALESCE(is_pinned, false) DESC,
            created_at ASC,
            id ASC
   LIMIT 1
   FOR UPDATE;

  IF FOUND THEN
    IF TG_OP = 'INSERT' THEN
      UPDATE public.profile_entries
         SET linked_note_id = COALESCE(public.profile_entries.linked_note_id, NEW.linked_note_id),
             updated_at = now()
       WHERE id = v_existing.id;
    END IF;
    RETURN NULL;
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.cleanup_profile_token_duplicates()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row record;
  v_group_key text := NULL;
  v_current_group_key text;
  v_seen_keys text[] := ARRAY[]::text[];
  v_new_value text;
  v_key text;
  v_updated int := 0;
  v_deleted int := 0;
BEGIN
  FOR v_row IN
    SELECT id, user_id, contact_id, label, value, created_at
    FROM public.profile_entries
    WHERE COALESCE(is_pinned, false) = false
    ORDER BY user_id,
             COALESCE(contact_id, '00000000-0000-0000-0000-000000000000'::uuid),
             public.profile_fact_label_key(label),
             created_at ASC,
             id ASC
  LOOP
    v_current_group_key := v_row.user_id::text || '|' || COALESCE(v_row.contact_id::text, '__owner__') || '|' || public.profile_fact_label_key(v_row.label);
    IF v_group_key IS DISTINCT FROM v_current_group_key THEN
      v_group_key := v_current_group_key;
      v_seen_keys := ARRAY[]::text[];
    END IF;

    v_new_value := public.profile_dedup_value_against_keys(v_row.value, v_seen_keys);

    IF btrim(coalesce(v_new_value, '')) = '' THEN
      DELETE FROM public.profile_entries WHERE id = v_row.id;
      v_deleted := v_deleted + 1;
    ELSE
      IF v_new_value IS DISTINCT FROM v_row.value THEN
        UPDATE public.profile_entries
           SET value = v_new_value,
               updated_at = now()
         WHERE id = v_row.id;
        v_updated := v_updated + 1;
      END IF;

      FOREACH v_key IN ARRAY public.profile_tokenize_value(v_new_value) LOOP
        v_seen_keys := array_append(v_seen_keys, v_key);
      END LOOP;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('rows_updated', v_updated, 'rows_deleted', v_deleted);
END;
$$;

SELECT public.cleanup_profile_token_duplicates();