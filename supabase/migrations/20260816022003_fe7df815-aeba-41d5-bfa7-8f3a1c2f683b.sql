CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA extensions;

-- 1. Deterministic label normalization key -----------------------------------
CREATE OR REPLACE FUNCTION public.profile_label_norm_key(t text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
    v_tokens text[];
    v_out text[] := ARRAY[]::text[];
    v_tok text;
    v_drop text[] := ARRAY['the','a','an','of','for','at','in','on','to','and','my','his','her','their','our','its',
                           'current','currently','present','other','another','additional','second','secondary',
                           'alternate','alternative','extra','side','further','more','general','misc','miscellaneous',
                           'info','information','detail','details','personal'];
BEGIN
    IF t IS NULL THEN RETURN ''; END IF;

    v_tokens := regexp_split_to_array(
        trim(regexp_replace(lower(t), '[^a-z0-9äöüß]+', ' ', 'g')),
        '\s+'
    );

    FOREACH v_tok IN ARRAY COALESCE(v_tokens, ARRAY[]::text[]) LOOP
        IF v_tok IS NULL OR length(v_tok) = 0 THEN CONTINUE; END IF;
        IF v_tok = ANY(v_drop) THEN CONTINUE; END IF;

        -- naive singularization
        IF length(v_tok) > 3 AND v_tok LIKE '%ies' THEN
            v_tok := left(v_tok, length(v_tok) - 3) || 'y';
        ELSIF length(v_tok) > 3 AND v_tok LIKE '%s' AND v_tok NOT LIKE '%ss' AND v_tok NOT LIKE '%us' THEN
            v_tok := left(v_tok, length(v_tok) - 1);
        END IF;

        -- synonym folding
        v_tok := CASE v_tok
            WHEN 'job' THEN 'occupation'
            WHEN 'work' THEN 'occupation'
            WHEN 'profession' THEN 'occupation'
            WHEN 'employment' THEN 'occupation'
            WHEN 'career' THEN 'occupation'
            WHEN 'gig' THEN 'occupation'
            WHEN 'company' THEN 'employer'
            WHEN 'firm' THEN 'employer'
            WHEN 'organisation' THEN 'employer'
            WHEN 'organization' THEN 'employer'
            WHEN 'workplace' THEN 'employer'
            WHEN 'town' THEN 'city'
            WHEN 'residence' THEN 'city'
            WHEN 'mobile' THEN 'phone'
            WHEN 'cell' THEN 'phone'
            WHEN 'cellphone' THEN 'phone'
            WHEN 'telephone' THEN 'phone'
            WHEN 'mail' THEN 'email'
            WHEN 'hobby' THEN 'interest'
            WHEN 'pastime' THEN 'interest'
            WHEN 'expertise' THEN 'skill'
            WHEN 'competency' THEN 'skill'
            WHEN 'competence' THEN 'skill'
            WHEN 'former' THEN 'previous'
            WHEN 'ex' THEN 'previous'
            WHEN 'prior' THEN 'previous'
            WHEN 'past' THEN 'previous'
            WHEN 'earlier' THEN 'previous'
            WHEN 'alias' THEN 'nickname'
            WHEN 'aka' THEN 'nickname'
            WHEN 'moniker' THEN 'nickname'
            WHEN 'title' THEN 'role'
            WHEN 'position' THEN 'role'
            WHEN 'designation' THEN 'role'
            WHEN 'favourite' THEN 'favorite'
            WHEN 'preferred' THEN 'favorite'
            WHEN 'beloved' THEN 'favorite'
            WHEN 'dish' THEN 'food'
            WHEN 'cuisine' THEN 'food'
            WHEN 'meal' THEN 'food'
            WHEN 'beverage' THEN 'drink'
            WHEN 'kid' THEN 'child'
            WHEN 'tongue' THEN 'language'
            WHEN 'birthday' THEN 'birth'
            WHEN 'dob' THEN 'birth'
            ELSE v_tok
        END;

        IF NOT (v_tok = ANY(v_out)) THEN
            v_out := array_append(v_out, v_tok);
        END IF;
    END LOOP;

    SELECT array_agg(x ORDER BY x) INTO v_out FROM unnest(v_out) AS x;
    RETURN COALESCE(array_to_string(v_out, ' '), '');
END;
$$;

-- 2. Value normalization key --------------------------------------------------
CREATE OR REPLACE FUNCTION public.profile_value_norm_key(t text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
    SELECT trim(regexp_replace(lower(regexp_replace(COALESCE(t, ''), '[^\w\s@\.\+/-]+', ' ', 'g')), '\s+', ' ', 'g'));
$$;

-- 3. Near-duplicate label resolver -------------------------------------------
-- Returns the label that should actually be used for a write: an existing
-- label on the same subject/category, or a registry canonical label, when the
-- incoming label is a near-duplicate. Returns NULL when it is genuinely new.
CREATE OR REPLACE FUNCTION public.profile_resolve_label(
    _user_id uuid,
    _contact_id uuid,
    _category_id uuid,
    _category_slug text,
    _label text
)
RETURNS text
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
    v_key text;
    v_match text;
BEGIN
    v_key := public.profile_label_norm_key(_label);
    IF v_key = '' THEN RETURN NULL; END IF;

    -- (a) exact canonical / alias hit in the registry
    SELECT canonical_label INTO v_match
    FROM public.profile_fields
    WHERE (user_id = _user_id OR user_id IS NULL)
      AND category_slug = _category_slug
      AND is_active = true
      AND (lower(canonical_label) = lower(trim(_label))
           OR lower(trim(_label)) = ANY(ARRAY(SELECT lower(a) FROM unnest(aliases) AS a)))
    ORDER BY user_id NULLS LAST
    LIMIT 1;
    IF v_match IS NOT NULL THEN RETURN v_match; END IF;

    -- (b) normalized-key hit against registry canonical labels and aliases
    SELECT canonical_label INTO v_match
    FROM public.profile_fields
    WHERE (user_id = _user_id OR user_id IS NULL)
      AND category_slug = _category_slug
      AND is_active = true
      AND (public.profile_label_norm_key(canonical_label) = v_key
           OR EXISTS (
                SELECT 1 FROM unnest(aliases) AS a
                WHERE public.profile_label_norm_key(a) = v_key
           ))
    ORDER BY user_id NULLS LAST
    LIMIT 1;
    IF v_match IS NOT NULL THEN RETURN v_match; END IF;

    -- (c) normalized-key hit against labels already stored for this subject
    SELECT e.label INTO v_match
    FROM public.profile_entries e
    WHERE e.user_id = _user_id
      AND e.contact_id IS NOT DISTINCT FROM _contact_id
      AND e.category_id = _category_id
      AND public.profile_label_norm_key(e.label) = v_key
    ORDER BY e.created_at ASC
    LIMIT 1;
    IF v_match IS NOT NULL THEN RETURN v_match; END IF;

    -- (d) strict trigram similarity against labels already stored for this subject
    SELECT e.label INTO v_match
    FROM public.profile_entries e
    WHERE e.user_id = _user_id
      AND e.contact_id IS NOT DISTINCT FROM _contact_id
      AND e.category_id = _category_id
      AND extensions.similarity(public.profile_label_norm_key(e.label), v_key) >= 0.82
    ORDER BY extensions.similarity(public.profile_label_norm_key(e.label), v_key) DESC
    LIMIT 1;

    RETURN v_match;
END;
$$;

-- 4. Wire the resolver + cross-label value collapse into the write trigger ----
CREATE OR REPLACE FUNCTION public.profile_entry_canonicalize()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
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

    v_canonical_label := regexp_replace(trim(NEW.label), '^[\p{P}\s]+|[\p{P}\s]+$', '', 'gu');

    -- Near-duplicate resolution BEFORE anything else: never create a second
    -- label that means the same as one we already have.
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
        IF v_human THEN
            -- Human-initiated writes may create a new field implicitly.
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
            );

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

    -- Cross-label value collapse: the same value must not appear twice in the
    -- same category under differently-worded labels.
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

        IF v_existing_lower = v_value_lower THEN RETURN NULL; END IF;

        IF length(v_value_lower) >= 6
           AND length(v_existing_lower) > length(v_value_lower)
           AND v_existing_lower LIKE '%' || v_value_lower || '%' THEN
            RETURN NULL;
        END IF;
        IF length(v_existing_lower) >= 6
           AND length(v_value_lower) > length(v_existing_lower)
           AND v_value_lower LIKE '%' || v_existing_lower || '%' THEN
            UPDATE public.profile_entries
            SET value = NEW.value, updated_at = now()
            WHERE id = v_existing.id;
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
            RETURN NULL;
        END IF;
    END IF;

    NEW.value := trim(NEW.value);
    RETURN NEW;
END;
$$;

-- 5. Retroactive sweep --------------------------------------------------------
CREATE OR REPLACE FUNCTION public.profile_dedup_sweep(_user_id uuid, _contact_id uuid DEFAULT NULL, _all_contacts boolean DEFAULT false)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_cluster record;
    v_row record;
    v_winner uuid;
    v_winner_label text;
    v_seen text[];
    v_merged text[];
    v_parts text[];
    v_part text;
    v_norm text;
    v_merged_labels int := 0;
    v_removed_rows int := 0;
BEGIN
    FOR v_cluster IN
        SELECT e.user_id, e.contact_id, e.category_id,
               public.profile_label_norm_key(e.label) AS key,
               count(*) AS n
        FROM public.profile_entries e
        WHERE e.user_id = _user_id
          AND (_all_contacts OR e.contact_id IS NOT DISTINCT FROM _contact_id)
        GROUP BY 1,2,3,4
        HAVING count(*) > 1
    LOOP
        v_winner := NULL;
        v_winner_label := NULL;
        v_seen := ARRAY[]::text[];
        v_merged := ARRAY[]::text[];

        FOR v_row IN
            SELECT e.id, e.label, e.value, e.created_at,
                   EXISTS (
                     SELECT 1 FROM public.profile_fields f
                     JOIN public.profile_categories c ON c.id = e.category_id
                     WHERE (f.user_id = e.user_id OR f.user_id IS NULL)
                       AND f.category_slug = c.slug
                       AND f.is_active = true
                       AND lower(f.canonical_label) = lower(e.label)
                   ) AS is_canonical
            FROM public.profile_entries e
            WHERE e.user_id = v_cluster.user_id
              AND e.contact_id IS NOT DISTINCT FROM v_cluster.contact_id
              AND e.category_id = v_cluster.category_id
              AND public.profile_label_norm_key(e.label) = v_cluster.key
            ORDER BY is_canonical DESC, e.created_at ASC
        LOOP
            IF v_winner IS NULL THEN
                v_winner := v_row.id;
                v_winner_label := v_row.label;
            END IF;

            v_parts := string_to_array(trim(v_row.value), ',');
            FOR i IN 1..coalesce(array_length(v_parts, 1), 0) LOOP
                v_part := trim(v_parts[i]);
                IF length(v_part) = 0 THEN CONTINUE; END IF;
                v_norm := lower(regexp_replace(v_part, '\s+', ' ', 'g'));
                IF NOT (v_norm = ANY(v_seen)) THEN
                    v_seen := array_append(v_seen, v_norm);
                    v_merged := array_append(v_merged, v_part);
                END IF;
            END LOOP;
        END LOOP;

        IF v_winner IS NOT NULL THEN
            UPDATE public.profile_entries
            SET value = array_to_string(v_merged, ', '), label = v_winner_label, updated_at = now()
            WHERE id = v_winner;

            WITH del AS (
                DELETE FROM public.profile_entries e
                WHERE e.user_id = v_cluster.user_id
                  AND e.contact_id IS NOT DISTINCT FROM v_cluster.contact_id
                  AND e.category_id = v_cluster.category_id
                  AND public.profile_label_norm_key(e.label) = v_cluster.key
                  AND e.id <> v_winner
                RETURNING 1
            )
            SELECT count(*) INTO v_removed_rows FROM del;

            v_merged_labels := v_merged_labels + 1;
        END IF;
    END LOOP;

    -- Cross-label duplicate values within the same category
    WITH ranked AS (
        SELECT e.id,
               row_number() OVER (
                 PARTITION BY e.user_id, e.contact_id, e.category_id, public.profile_value_norm_key(e.value)
                 ORDER BY e.created_at ASC
               ) AS rn
        FROM public.profile_entries e
        WHERE e.user_id = _user_id
          AND (_all_contacts OR e.contact_id IS NOT DISTINCT FROM _contact_id)
          AND length(public.profile_value_norm_key(e.value)) >= 6
    )
    DELETE FROM public.profile_entries pe
    USING ranked r
    WHERE pe.id = r.id AND r.rn > 1;

    RETURN jsonb_build_object('clusters_merged', v_merged_labels, 'rows_removed', v_removed_rows);
END;
$$;

REVOKE ALL ON FUNCTION public.profile_dedup_sweep(uuid, uuid, boolean) FROM public;
GRANT EXECUTE ON FUNCTION public.profile_dedup_sweep(uuid, uuid, boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.profile_resolve_label(uuid, uuid, uuid, text, text) TO authenticated, service_role;