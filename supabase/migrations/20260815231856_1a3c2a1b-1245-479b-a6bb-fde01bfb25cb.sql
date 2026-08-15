
-- Identifier-like values (emails, phones, URLs, @handles) must never be folded
-- into, absorbed by, or token-merged with other profile values. They are atomic
-- facts: only an exact duplicate under the same field may be suppressed.
CREATE OR REPLACE FUNCTION public.profile_value_is_identifier(t text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public'
AS $function$
  SELECT coalesce(t, '') ~* '(^|\s)(@[[:alnum:]._-]+|[[:alnum:]._%+-]+@[[:alnum:].-]+\.[[:alpha:]]{2,}|https?://\S+|[[:alnum:]-]+\.(com|net|org|io|ai|de|co|app)(/\S*)?|\+?[0-9][0-9 ()./-]{6,}[0-9])(\s|$)';
$function$;

CREATE OR REPLACE FUNCTION public.profile_entries_dedup_before_insert()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_canonical text;
  v_is_accumulator boolean;
  v_new_tokens text[];
  v_existing record;
  v_existing_tokens text[];
  v_merged_tokens text[];
  v_merged_value text;
BEGIN
  IF NEW.value IS NULL OR btrim(NEW.value) = '' THEN
    RETURN NEW;
  END IF;

  v_canonical := public.profile_canonical_label(NEW.label);

  -- Identifier values: exact duplicate only, never merged.
  IF public.profile_value_is_identifier(NEW.value) THEN
    PERFORM 1
      FROM public.profile_entries
     WHERE user_id = NEW.user_id
       AND contact_id IS NOT DISTINCT FROM NEW.contact_id
       AND id IS DISTINCT FROM NEW.id
       AND public.profile_canonical_label(label) = v_canonical
       AND public.profile_norm_value(value) = public.profile_norm_value(NEW.value);
    IF FOUND THEN
      RETURN NULL;
    END IF;
    RETURN NEW;
  END IF;

  v_is_accumulator := public.profile_is_accumulator_label(v_canonical);
  v_new_tokens := public.profile_tokenize_value(NEW.value);

  IF v_is_accumulator THEN
    SELECT id, label, value INTO v_existing
    FROM public.profile_entries
    WHERE user_id = NEW.user_id
      AND contact_id IS NOT DISTINCT FROM NEW.contact_id
      AND public.profile_canonical_label(label) = v_canonical
      AND COALESCE(is_pinned, false) = false
    ORDER BY created_at ASC
    LIMIT 1
    FOR UPDATE;

    IF FOUND THEN
      v_existing_tokens := public.profile_tokenize_value(v_existing.value);

      SELECT array_agg(tok ORDER BY ord) INTO v_merged_tokens
      FROM (
        SELECT DISTINCT ON (lower(tok)) tok, ord
        FROM (
          SELECT unnest(v_existing_tokens) AS tok, generate_subscripts(v_existing_tokens, 1) AS ord
          UNION ALL
          SELECT unnest(v_new_tokens) AS tok,
                 array_length(v_existing_tokens, 1) + generate_subscripts(v_new_tokens, 1) AS ord
        ) all_tokens
        WHERE tok IS NOT NULL AND btrim(tok) <> ''
        ORDER BY lower(tok), ord
      ) deduped;

      IF v_merged_tokens IS NULL OR array_length(v_merged_tokens, 1) IS NULL THEN
        RETURN NULL;
      END IF;

      v_merged_value := array_to_string(v_merged_tokens, ', ');

      IF public.profile_norm_value(v_merged_value) = public.profile_norm_value(v_existing.value) THEN
        RETURN NULL;
      END IF;

      UPDATE public.profile_entries
         SET value = v_merged_value,
             updated_at = now(),
             linked_note_id = COALESCE(NEW.linked_note_id, linked_note_id)
       WHERE id = v_existing.id;

      RETURN NULL;
    END IF;

    RETURN NEW;
  END IF;

  DECLARE
    v_existing2 record;
    v_existing2_tokens text[];
  BEGIN
    FOR v_existing2 IN
      SELECT id, label, value
      FROM public.profile_entries
      WHERE user_id = NEW.user_id
        AND contact_id IS NOT DISTINCT FROM NEW.contact_id
        AND public.profile_canonical_label(label) = v_canonical
        AND COALESCE(is_pinned, false) = false
      FOR UPDATE
    LOOP
      v_existing2_tokens := public.profile_tokenize_value(v_existing2.value);

      IF public.profile_norm_value(v_existing2.value) = public.profile_norm_value(NEW.value) THEN
        RETURN NULL;
      END IF;

      -- Never let an identifier-bearing existing row be overwritten by a merge.
      IF public.profile_value_is_identifier(v_existing2.value) THEN
        CONTINUE;
      END IF;

      IF array_length(v_new_tokens, 1) IS NOT NULL
         AND v_new_tokens <@ v_existing2_tokens
         AND array_length(v_new_tokens, 1) < array_length(v_existing2_tokens, 1) THEN
        RETURN NULL;
      END IF;

      IF array_length(v_existing2_tokens, 1) IS NOT NULL
         AND v_existing2_tokens <@ v_new_tokens
         AND array_length(v_existing2_tokens, 1) < array_length(v_new_tokens, 1) THEN
        UPDATE public.profile_entries
           SET value = NEW.value,
               updated_at = now(),
               linked_note_id = COALESCE(NEW.linked_note_id, linked_note_id)
         WHERE id = v_existing2.id;
        RETURN NULL;
      END IF;
    END LOOP;
  END;

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.profile_entries_prevent_duplicate_fact()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_label_key text;
  v_value_key text;
  v_existing record;
  v_existing_keys text[];
BEGIN
  IF pg_trigger_depth() > 1 THEN
    RETURN NEW;
  END IF;

  IF NEW.value IS NULL OR btrim(NEW.value) = '' THEN
    RETURN NEW;
  END IF;

  -- Identifier values are atomic: only an exact duplicate under the same field
  -- is suppressed; never token-stripped, never absorbed by a longer value.
  IF public.profile_value_is_identifier(NEW.value) THEN
    SELECT id INTO v_existing
      FROM public.profile_entries
     WHERE user_id = NEW.user_id
       AND contact_id IS NOT DISTINCT FROM NEW.contact_id
       AND id IS DISTINCT FROM NEW.id
       AND public.profile_fact_label_key(label) = public.profile_fact_label_key(NEW.label)
       AND public.profile_fact_text_key(value) = public.profile_fact_text_key(NEW.value)
     LIMIT 1;
    IF FOUND THEN
      RETURN NULL;
    END IF;
    RETURN NEW;
  END IF;

  NEW.value := public.profile_dedup_value_tokens(NEW.label, NEW.value);

  IF NEW.value IS NULL OR btrim(NEW.value) = '' THEN
    RETURN NULL;
  END IF;

  SELECT COALESCE(array_agg(DISTINCT k), ARRAY[]::text[])
    INTO v_existing_keys
    FROM public.profile_entries pe
    CROSS JOIN LATERAL unnest(public.profile_tokenize_value(pe.value)) AS k
   WHERE pe.user_id = NEW.user_id
     AND pe.contact_id IS NOT DISTINCT FROM NEW.contact_id
     AND pe.id IS DISTINCT FROM NEW.id
     AND COALESCE(pe.is_pinned, false) = false
     AND public.profile_duplicate_scope_key(pe.label) = public.profile_duplicate_scope_key(NEW.label);

  NEW.value := public.profile_dedup_value_against_keys(NEW.value, v_existing_keys);

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
$function$;
