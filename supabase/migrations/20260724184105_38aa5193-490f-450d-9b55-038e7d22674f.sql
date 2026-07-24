CREATE OR REPLACE FUNCTION public.profile_label_token_priority(_label text)
RETURNS integer
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  WITH l AS (
    SELECT public.profile_fact_label_key(_label) AS k
  )
  SELECT CASE
    WHEN k ~ '(order|go to recipe)' THEN 120
    WHEN k ~ '(dessert|fruit|snack|drink|beverage|recipe|restaurant|cuisine)' THEN 110
    WHEN k ~ '(song|music artist|artist|actor|character|tv show|series|movie|manga|youtube|youtuber|pokemon|animal|avatar creator)' THEN 110
    WHEN k ~ '(city|country|address|birthday|birthdate|age|pronoun|name|email|phone|language)' THEN 105
    WHEN k ~ '(condition|allerg|medication|diagnosis|therapy|care need)' THEN 105
    WHEN k ~ '(skill|job|work|project|goal|school|education)' THEN 95
    WHEN k ~ '(hobby|interest|preference|likes|favorite food|favorite)' THEN 70
    WHEN k ~ '(note|misc|other|general)' THEN 20
    ELSE 80
  END
  FROM l;
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
  v_new_priority int;
  v_new_value text;
BEGIN
  IF pg_trigger_depth() > 1 THEN
    RETURN NEW;
  END IF;

  IF NEW.value IS NULL OR btrim(NEW.value) = '' THEN
    RETURN NEW;
  END IF;

  NEW.value := public.profile_dedup_value_tokens(NEW.label, NEW.value);

  IF NEW.value IS NULL OR btrim(NEW.value) = '' THEN
    RETURN NULL;
  END IF;

  v_new_priority := public.profile_label_token_priority(NEW.label);

  -- If an equal-or-better existing row already carries a token, drop that token from NEW.
  SELECT COALESCE(array_agg(DISTINCT k), ARRAY[]::text[])
    INTO v_existing_keys
    FROM public.profile_entries pe
    CROSS JOIN LATERAL unnest(public.profile_tokenize_value(pe.value)) AS k
   WHERE pe.user_id = NEW.user_id
     AND pe.contact_id IS NOT DISTINCT FROM NEW.contact_id
     AND pe.id IS DISTINCT FROM NEW.id
     AND COALESCE(pe.is_pinned, false) = false
     AND public.profile_label_token_priority(pe.label) >= v_new_priority;

  NEW.value := public.profile_dedup_value_against_keys(NEW.value, v_existing_keys);

  IF NEW.value IS NULL OR btrim(NEW.value) = '' THEN
    RETURN NULL;
  END IF;

  -- If NEW is more specific, remove its tokens from lower-priority existing rows.
  FOR v_existing IN
    SELECT pe.id, pe.value
    FROM public.profile_entries pe
    WHERE pe.user_id = NEW.user_id
      AND pe.contact_id IS NOT DISTINCT FROM NEW.contact_id
      AND pe.id IS DISTINCT FROM NEW.id
      AND COALESCE(pe.is_pinned, false) = false
      AND public.profile_label_token_priority(pe.label) < v_new_priority
      AND EXISTS (
        SELECT 1
        FROM unnest(public.profile_tokenize_value(pe.value)) AS old_key
        CROSS JOIN unnest(public.profile_tokenize_value(NEW.value)) AS new_key
        WHERE public.profile_token_keys_overlap(old_key, new_key)
      )
    FOR UPDATE
  LOOP
    SELECT public.profile_dedup_value_against_keys(v_existing.value, public.profile_tokenize_value(NEW.value))
      INTO v_new_value;

    IF btrim(coalesce(v_new_value, '')) = '' THEN
      DELETE FROM public.profile_entries WHERE id = v_existing.id;
    ELSIF v_new_value IS DISTINCT FROM v_existing.value THEN
      UPDATE public.profile_entries
         SET value = v_new_value,
             updated_at = now()
       WHERE id = v_existing.id;
    END IF;
  END LOOP;

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
             public.profile_label_token_priority(label) DESC,
             created_at ASC,
             id ASC
  LOOP
    v_current_group_key := v_row.user_id::text || '|' || COALESCE(v_row.contact_id::text, '__owner__');
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

REVOKE ALL ON FUNCTION public.profile_entries_prevent_duplicate_fact() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.cleanup_profile_token_duplicates() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cleanup_profile_token_duplicates() TO service_role;

SELECT public.cleanup_profile_token_duplicates();