CREATE OR REPLACE FUNCTION public.profile_entry_canonicalize()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $fn$
DECLARE
    v_category_slug text;
    v_field record;
    v_canonical_label text;
    v_cardinality text;
    v_normalized_value text;
    v_name text;
    v_existing record;
    v_review_payload jsonb;
    v_value_lower text;
    v_existing_lower text;
    v_resolved text;
    v_human boolean;
    v_bool_filler text[] := ARRAY['yes','no','true','false','n/a','na','unknown','-','none','maybe','perhaps','unsure','not sure','idk'];
    v_stripped text;
    v_leading_verbs text[] := ARRAY['has','have','had','is','was','are','were','suffers from','diagnosed with'];
    v_parts text[];
    v_part text;
    v_seen text[];
    v_merged text[];
    v_norm text;
BEGIN
    IF current_setting('menerio.profile_guard', true) = 'on' THEN
        RETURN NEW;
    END IF;

    SELECT slug INTO v_category_slug
    FROM public.profile_categories
    WHERE id = NEW.category_id;

    IF v_category_slug IS NULL THEN
        RAISE EXCEPTION 'Invalid category_id %', NEW.category_id;
    END IF;

    IF NEW.contact_id IS NOT NULL THEN
        SELECT name INTO v_name FROM public.contacts WHERE id = NEW.contact_id;
    ELSE
        SELECT display_name INTO v_name FROM public.profiles WHERE id = NEW.user_id;
    END IF;

    v_human := COALESCE(NEW.origin, '') IN ('review_queue', 'user_manual', 'user');

    v_canonical_label := regexp_replace(trim(NEW.label), '^[[:punct:][:space:]]+|[[:punct:][:space:]]+$', '', 'g');

    v_resolved := public.profile_resolve_label(
        NEW.user_id, NEW.contact_id, NEW.category_id, v_category_slug, v_canonical_label
    );
    IF v_resolved IS NOT NULL THEN
        v_canonical_label := v_resolved;
        NEW.label := v_resolved;
    END IF;

    SELECT * INTO v_field
    FROM public.profile_fields
    WHERE (user_id = NEW.user_id OR user_id IS NULL)
      AND category_slug = v_category_slug
      AND is_active = true
      AND (lower(canonical_label) = lower(v_canonical_label)
           OR lower(v_canonical_label) = ANY(ARRAY(SELECT lower(a) FROM unnest(aliases) AS a)))
    ORDER BY user_id NULLS LAST
    LIMIT 1;

    IF v_field IS NULL THEN
        IF v_human OR TG_OP = 'UPDATE' THEN
            -- Human edits and cleanup rewrites of rows that already exist are
            -- authoritative: register the field instead of asking again.
            INSERT INTO public.profile_fields (user_id, category_slug, canonical_label, cardinality, value_type, aliases, is_system)
            VALUES (NEW.user_id, v_category_slug, v_canonical_label, 'list', 'text', ARRAY[]::text[], false)
            ON CONFLICT DO NOTHING;
            NEW.label := v_canonical_label;
            v_cardinality := 'list';
        ELSIF EXISTS (
            SELECT 1 FROM public.profile_fields
            WHERE category_slug = v_category_slug AND is_system = true AND is_active = true
        ) THEN
            v_review_payload := jsonb_build_object(
                'label', NEW.label,
                'canonical_label', v_canonical_label,
                'value', NEW.value,
                'category_id', NEW.category_id,
                'category_slug', v_category_slug,
                'contact_id', NEW.contact_id,
                'linked_note_id', NEW.linked_note_id,
                'origin', NEW.origin,
                'evidence_quote', NEW.evidence_quote
            );

            INSERT INTO public.review_queue (
                user_id, source_note_id, suggestion_type, title, description, payload,
                target_entity_type, target_entity_id, extracted_value, status
            ) VALUES (
                NEW.user_id, NEW.linked_note_id, 'unknown_profile_field',
                'New profile field: ' || NEW.label, NEW.value, v_review_payload,
                CASE WHEN NEW.contact_id IS NULL THEN 'self' ELSE 'contact' END,
                COALESCE(NEW.contact_id, NEW.user_id), NEW.value, 'pending'
            )
            ON CONFLICT DO NOTHING;

            RETURN NULL;
        ELSE
            v_canonical_label := NEW.label;
            v_cardinality := 'list';
        END IF;
    ELSE
        v_canonical_label := v_field.canonical_label;
        v_cardinality := v_field.cardinality;
        NEW.label := v_canonical_label;
    END IF;

    v_normalized_value := lower(trim(NEW.value));

    IF length(v_normalized_value) <= 1 THEN RETURN NULL; END IF;
    IF v_normalized_value = ANY(v_bool_filler) THEN RETURN NULL; END IF;

    v_stripped := v_normalized_value;
    FOR i IN 1..array_length(v_leading_verbs, 1) LOOP
        IF v_stripped ~ ('^' || v_leading_verbs[i] || '\s+') THEN
            v_stripped := regexp_replace(v_stripped, ('^' || v_leading_verbs[i] || '\s+'), '', 'i');
            EXIT;
        END IF;
    END LOOP;

    IF lower(trim(v_stripped)) = lower(trim(v_canonical_label)) THEN RETURN NULL; END IF;
    IF v_name IS NOT NULL AND v_normalized_value = lower(trim(v_name)) THEN RETURN NULL; END IF;

    IF length(public.profile_value_norm_key(NEW.value)) >= 6 THEN
        PERFORM 1
        FROM public.profile_entries e
        WHERE e.user_id = NEW.user_id
          AND e.contact_id IS NOT DISTINCT FROM NEW.contact_id
          AND e.category_id = NEW.category_id
          AND e.id IS DISTINCT FROM NEW.id
          AND (
            public.profile_value_norm_key(e.value) = public.profile_value_norm_key(NEW.value)
            OR (', ' || public.profile_value_norm_key(e.value) || ', ')
                LIKE ('%, ' || public.profile_value_norm_key(NEW.value) || ', %')
          );
        IF FOUND THEN RETURN NULL; END IF;
    END IF;

    PERFORM set_config('menerio.profile_guard', 'on', true);

    FOR v_existing IN
        SELECT id, value
        FROM public.profile_entries
        WHERE user_id = NEW.user_id
          AND contact_id IS NOT DISTINCT FROM NEW.contact_id
          AND category_id = NEW.category_id
          AND label = v_canonical_label
          AND id IS DISTINCT FROM NEW.id
    LOOP
        v_existing_lower := lower(regexp_replace(trim(v_existing.value), '\s+', ' ', 'g'));
        v_value_lower := lower(regexp_replace(trim(NEW.value), '\s+', ' ', 'g'));

        IF v_existing_lower = v_value_lower THEN
            PERFORM set_config('menerio.profile_guard', 'off', true);
            RETURN NULL;
        END IF;

        IF length(v_value_lower) >= 6
           AND length(v_existing_lower) > length(v_value_lower)
           AND v_existing_lower LIKE '%' || v_value_lower || '%' THEN
            PERFORM set_config('menerio.profile_guard', 'off', true);
            RETURN NULL;
        END IF;
        IF length(v_existing_lower) >= 6
           AND length(v_value_lower) > length(v_existing_lower)
           AND v_value_lower LIKE '%' || v_existing_lower || '%' THEN
            UPDATE public.profile_entries
            SET value = NEW.value, updated_at = now()
            WHERE id = v_existing.id;
            PERFORM set_config('menerio.profile_guard', 'off', true);
            RETURN NULL;
        END IF;
    END LOOP;

    IF v_cardinality = 'single' THEN
        SELECT id, value INTO v_existing
        FROM public.profile_entries
        WHERE user_id = NEW.user_id
          AND contact_id IS NOT DISTINCT FROM NEW.contact_id
          AND category_id = NEW.category_id
          AND label = v_canonical_label
          AND id IS DISTINCT FROM NEW.id
        LIMIT 1;

        IF FOUND THEN
            UPDATE public.profile_entries
            SET value = NEW.value, updated_at = now()
            WHERE id = v_existing.id;
            PERFORM set_config('menerio.profile_guard', 'off', true);
            RETURN NULL;
        END IF;
    END IF;

    IF v_cardinality = 'list' THEN
        SELECT id, value INTO v_existing
        FROM public.profile_entries
        WHERE user_id = NEW.user_id
          AND contact_id IS NOT DISTINCT FROM NEW.contact_id
          AND category_id = NEW.category_id
          AND label = v_canonical_label
          AND id IS DISTINCT FROM NEW.id
        LIMIT 1;

        IF FOUND THEN
            v_seen := ARRAY[]::text[];
            v_merged := ARRAY[]::text[];

            v_parts := string_to_array(trim(v_existing.value), ',');
            FOR i IN 1..coalesce(array_length(v_parts, 1), 0) LOOP
                v_part := trim(v_parts[i]);
                IF length(v_part) = 0 THEN CONTINUE; END IF;
                v_norm := lower(regexp_replace(v_part, '\s+', ' ', 'g'));
                IF NOT (v_norm = ANY(v_seen)) THEN
                    v_seen := array_append(v_seen, v_norm);
                    v_merged := array_append(v_merged, v_part);
                END IF;
            END LOOP;

            v_parts := string_to_array(trim(NEW.value), ',');
            FOR i IN 1..coalesce(array_length(v_parts, 1), 0) LOOP
                v_part := trim(v_parts[i]);
                IF length(v_part) = 0 THEN CONTINUE; END IF;
                v_norm := lower(regexp_replace(v_part, '\s+', ' ', 'g'));
                IF NOT (v_norm = ANY(v_seen)) THEN
                    v_seen := array_append(v_seen, v_norm);
                    v_merged := array_append(v_merged, v_part);
                END IF;
            END LOOP;

            IF array_length(v_merged, 1) > 0 THEN
                UPDATE public.profile_entries
                SET value = array_to_string(v_merged, ', '), updated_at = now()
                WHERE id = v_existing.id;
            END IF;
            PERFORM set_config('menerio.profile_guard', 'off', true);
            RETURN NULL;
        END IF;
    END IF;

    PERFORM set_config('menerio.profile_guard', 'off', true);

    NEW.value := trim(NEW.value);
    RETURN NEW;
END;
$fn$;