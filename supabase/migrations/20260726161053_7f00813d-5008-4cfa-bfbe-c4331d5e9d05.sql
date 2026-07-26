CREATE OR REPLACE FUNCTION public.relationship_canonical_label(p text)
RETURNS text LANGUAGE plpgsql IMMUTABLE SET search_path = public AS $$
DECLARE k text; direct text; first_seg text; last_word text; last_canon text; is_ex boolean; bare text;
BEGIN
  k := public.relationship_normalize_label(p);
  IF k IS NULL THEN RETURN NULL; END IF;

  direct := public.relationship_label_map(k);
  IF direct IS NOT NULL THEN RETURN direct; END IF;

  IF k LIKE '% / %' THEN
    first_seg := public.relationship_label_map(split_part(k, ' / ', 1));
    IF first_seg IS NOT NULL THEN RETURN first_seg; END IF;
  END IF;

  is_ex := k ~ '^(ex-|ex |former )';
  last_word := regexp_replace(split_part(k, ' ', array_length(string_to_array(k, ' '), 1)), '^ex-', '');
  last_canon := public.relationship_label_map(last_word);

  IF last_canon IS NOT NULL AND array_length(string_to_array(k, ' '), 1) > 1 THEN
    RETURN CASE WHEN is_ex THEN 'ex-' || last_canon ELSE last_canon END;
  END IF;

  IF is_ex AND array_length(string_to_array(k, ' '), 1) = 1 THEN
    bare := public.relationship_label_map(regexp_replace(k, '^ex-', ''));
    IF bare IS NOT NULL THEN RETURN 'ex-' || bare; END IF;
  END IF;

  RETURN k;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.relationship_canonical_label(text) FROM PUBLIC, anon;