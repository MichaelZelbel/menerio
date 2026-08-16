CREATE OR REPLACE FUNCTION public.profile_label_tokens(_label text)
RETURNS text[]
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $fn$
  SELECT COALESCE(array_agg(DISTINCT t ORDER BY t), ARRAY[]::text[])
  FROM unnest(string_to_array(
         public.profile_label_norm_key(
           regexp_replace(_label, '[^[:alnum:] ]+', ' ', 'g')
         ), ' ')) AS t
  WHERE length(t) > 1
    AND t NOT IN ('and','or','the','of','a','an','my','other','item','items','type','types','general','misc','info');
$fn$;

CREATE OR REPLACE FUNCTION public.profile_subset_label_sweep(
  _user_id uuid, _contact_id uuid DEFAULT NULL, _all_contacts boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
    v_pair record;
    v_merged int := 0;
BEGIN
    PERFORM set_config('menerio.profile_guard', 'on', true);

    LOOP
        SELECT broad.id AS broad_id, broad.value AS broad_value,
               narrow.id AS narrow_id, narrow.value AS narrow_value
        INTO v_pair
        FROM public.profile_entries broad
        JOIN public.profile_entries narrow
          ON narrow.user_id = broad.user_id
         AND narrow.contact_id IS NOT DISTINCT FROM broad.contact_id
         AND narrow.category_id = broad.category_id
         AND narrow.id <> broad.id
        WHERE broad.user_id = _user_id
          AND (_all_contacts OR broad.contact_id IS NOT DISTINCT FROM _contact_id)
          AND (
            public.profile_label_tokens_subset(
              public.profile_label_tokens(broad.label),
              public.profile_label_tokens(narrow.label))
            -- identical meaning, different wording ("Favorite food item")
            OR (public.profile_label_tokens(broad.label) = public.profile_label_tokens(narrow.label)
                AND array_length(public.profile_label_tokens(broad.label), 1) IS NOT NULL
                AND broad.created_at <= narrow.created_at
                AND broad.label <> narrow.label)
          )
        ORDER BY broad.created_at ASC
        LIMIT 1;

        EXIT WHEN NOT FOUND;

        UPDATE public.profile_entries
        SET value = (
              SELECT string_agg(part, ', ')
              FROM (
                SELECT DISTINCT ON (lower(trim(p))) trim(p) AS part
                FROM unnest(
                  string_to_array(v_pair.broad_value, ',') ||
                  string_to_array(v_pair.narrow_value, ',')
                ) AS p
                WHERE length(trim(p)) > 0
              ) s
            ),
            updated_at = now()
        WHERE id = v_pair.broad_id;

        DELETE FROM public.profile_entries WHERE id = v_pair.narrow_id;
        v_merged := v_merged + 1;

        EXIT WHEN v_merged > 5000;
    END LOOP;

    PERFORM set_config('menerio.profile_guard', 'off', true);
    RETURN jsonb_build_object('labels_merged', v_merged);
END;
$fn$;