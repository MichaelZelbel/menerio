-- Significant token set of a label, used for subset-based duplicate detection.
CREATE OR REPLACE FUNCTION public.profile_label_tokens(_label text)
RETURNS text[]
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $fn$
  SELECT COALESCE(array_agg(DISTINCT t ORDER BY t), ARRAY[]::text[])
  FROM unnest(string_to_array(public.profile_label_norm_key(_label), ' ')) AS t
  WHERE length(t) > 1
    AND t NOT IN ('and','or','the','of','a','an','my','other','item','items','type','types','general','misc','info');
$fn$;

-- True when a is a strict subset of b (b is the more specific wording).
CREATE OR REPLACE FUNCTION public.profile_label_tokens_subset(a text[], b text[])
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $fn$
  SELECT array_length(a, 1) IS NOT NULL
     AND array_length(b, 1) IS NOT NULL
     AND a <@ b
     AND array_length(a, 1) < array_length(b, 1);
$fn$;

CREATE OR REPLACE FUNCTION public.profile_resolve_label(
  _user_id uuid, _contact_id uuid, _category_id uuid, _category_slug text, _label text
)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
    v_key text;
    v_match text;
    v_tokens text[];
BEGIN
    v_key := public.profile_label_norm_key(_label);
    IF v_key = '' THEN RETURN NULL; END IF;

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

    SELECT e.label INTO v_match
    FROM public.profile_entries e
    WHERE e.user_id = _user_id
      AND e.contact_id IS NOT DISTINCT FROM _contact_id
      AND e.category_id = _category_id
      AND public.profile_label_norm_key(e.label) = v_key
    ORDER BY e.created_at ASC
    LIMIT 1;
    IF v_match IS NOT NULL THEN RETURN v_match; END IF;

    SELECT e.label INTO v_match
    FROM public.profile_entries e
    WHERE e.user_id = _user_id
      AND e.contact_id IS NOT DISTINCT FROM _contact_id
      AND e.category_id = _category_id
      AND extensions.similarity(public.profile_label_norm_key(e.label), v_key) >= 0.82
    ORDER BY extensions.similarity(public.profile_label_norm_key(e.label), v_key) DESC
    LIMIT 1;
    IF v_match IS NOT NULL THEN RETURN v_match; END IF;

    -- (e) token containment: "Favorite food item" / "Favorite foods and drinks"
    -- both contain the tokens of the broader "Favorite foods" already stored.
    -- The broader label always wins so specific variants stop multiplying.
    v_tokens := public.profile_label_tokens(_label);
    IF array_length(v_tokens, 1) IS NULL THEN RETURN NULL; END IF;

    SELECT e.label INTO v_match
    FROM public.profile_entries e
    WHERE e.user_id = _user_id
      AND e.contact_id IS NOT DISTINCT FROM _contact_id
      AND e.category_id = _category_id
      AND (
        public.profile_label_tokens_subset(public.profile_label_tokens(e.label), v_tokens)
        OR public.profile_label_tokens_subset(v_tokens, public.profile_label_tokens(e.label))
      )
    ORDER BY array_length(public.profile_label_tokens(e.label), 1) ASC, e.created_at ASC
    LIMIT 1;

    IF v_match IS NOT NULL
       AND array_length(public.profile_label_tokens(v_match), 1) <= array_length(v_tokens, 1) THEN
        RETURN v_match;
    END IF;

    RETURN NULL;
END;
$fn$;

-- Retroactive pass: collapse label clusters where one label's tokens are a
-- subset of another's within the same person + category.
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
        SELECT broad.id AS broad_id, broad.label AS broad_label, broad.value AS broad_value,
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
          AND public.profile_label_tokens_subset(
                public.profile_label_tokens(broad.label),
                public.profile_label_tokens(narrow.label))
        ORDER BY broad.created_at ASC
        LIMIT 1;

        EXIT WHEN NOT FOUND;

        UPDATE public.profile_entries
        SET value = (
              SELECT string_agg(DISTINCT_part, ', ')
              FROM (
                SELECT DISTINCT ON (lower(trim(p))) trim(p) AS DISTINCT_part
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

REVOKE EXECUTE ON FUNCTION public.profile_subset_label_sweep(uuid, uuid, boolean) FROM anon;
GRANT EXECUTE ON FUNCTION public.profile_subset_label_sweep(uuid, uuid, boolean) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.profile_label_tokens(text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.profile_label_tokens_subset(text[], text[]) FROM anon;