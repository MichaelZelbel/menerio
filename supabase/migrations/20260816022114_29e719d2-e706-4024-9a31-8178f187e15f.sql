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
    v_cardinality text;
    v_latest_value text;
    v_seen text[];
    v_merged text[];
    v_parts text[];
    v_part text;
    v_norm text;
    v_merged_labels int := 0;
    v_removed_rows int := 0;
    v_deleted int := 0;
BEGIN
    FOR v_cluster IN
        SELECT e.user_id, e.contact_id, e.category_id, pc.slug AS category_slug,
               public.profile_label_norm_key(e.label) AS key
        FROM public.profile_entries e
        JOIN public.profile_categories pc ON pc.id = e.category_id
        WHERE e.user_id = _user_id
          AND (_all_contacts OR e.contact_id IS NOT DISTINCT FROM _contact_id)
        GROUP BY 1,2,3,4,5
        HAVING count(*) > 1
    LOOP
        v_winner := NULL;
        v_winner_label := NULL;
        v_latest_value := NULL;
        v_seen := ARRAY[]::text[];
        v_merged := ARRAY[]::text[];

        FOR v_row IN
            SELECT e.id, e.label, e.value, e.created_at,
                   EXISTS (
                     SELECT 1 FROM public.profile_fields f
                     WHERE (f.user_id = e.user_id OR f.user_id IS NULL)
                       AND f.category_slug = v_cluster.category_slug
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
            v_latest_value := v_row.value;

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

        IF v_winner IS NULL THEN CONTINUE; END IF;

        SELECT f.cardinality INTO v_cardinality
        FROM public.profile_fields f
        WHERE (f.user_id = v_cluster.user_id OR f.user_id IS NULL)
          AND f.category_slug = v_cluster.category_slug
          AND f.is_active = true
          AND lower(f.canonical_label) = lower(v_winner_label)
        ORDER BY f.user_id NULLS LAST
        LIMIT 1;

        UPDATE public.profile_entries
        SET value = CASE WHEN COALESCE(v_cardinality, 'list') = 'single'
                         THEN v_latest_value
                         ELSE array_to_string(v_merged, ', ') END,
            label = v_winner_label,
            updated_at = now()
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
        SELECT count(*) INTO v_deleted FROM del;

        v_removed_rows := v_removed_rows + COALESCE(v_deleted, 0);
        v_merged_labels := v_merged_labels + 1;
    END LOOP;

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
    ),
    del2 AS (
        DELETE FROM public.profile_entries pe
        USING ranked r
        WHERE pe.id = r.id AND r.rn > 1
        RETURNING 1
    )
    SELECT count(*) INTO v_deleted FROM del2;
    v_removed_rows := v_removed_rows + COALESCE(v_deleted, 0);

    RETURN jsonb_build_object('clusters_merged', v_merged_labels, 'rows_removed', v_removed_rows);
END;
$$;

REVOKE ALL ON FUNCTION public.profile_dedup_sweep(uuid, uuid, boolean) FROM public;
GRANT EXECUTE ON FUNCTION public.profile_dedup_sweep(uuid, uuid, boolean) TO service_role;