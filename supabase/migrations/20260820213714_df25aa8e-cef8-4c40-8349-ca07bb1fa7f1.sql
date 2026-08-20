CREATE OR REPLACE FUNCTION public.profile_split_fact_value(p_label text, p_value text)
RETURNS text[]
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  v text := btrim(coalesce(p_value, ''));
  lbl text := lower(btrim(coalesce(p_label, '')));
  ch text;
  depth int := 0;
  cur text := '';
  seps int := 0;
  segs text[] := ARRAY[]::text[];
  seg text;
  out_arr text[] := ARRAY[]::text[];
  seen text[] := ARRAY[]::text[];
  i int;
  pass int;
  respect boolean := true;
BEGIN
  IF v = '' THEN RETURN ARRAY[]::text[]; END IF;
  IF lbl IN ('professional summary','self description','how we met','bio','note','summary') THEN
    RETURN ARRAY[v];
  END IF;

  -- Pass 1 respects brackets; if the value ends with an unclosed bracket
  -- (common in truncated legacy bags) pass 2 ignores brackets entirely.
  FOR pass IN 1..2 LOOP
    depth := 0; cur := ''; seps := 0; segs := ARRAY[]::text[];
    FOR i IN 1..length(v) LOOP
      ch := substr(v, i, 1);
      IF respect THEN
        IF ch IN ('(', '[') THEN depth := depth + 1;
        ELSIF ch IN (')', ']') THEN depth := greatest(0, depth - 1);
        END IF;
      END IF;
      IF depth = 0 AND (ch = ',' OR ch = ';' OR ch = E'\n') THEN
        seps := seps + 1;
        segs := segs || cur;
        cur := '';
      ELSE
        cur := cur || ch;
      END IF;
    END LOOP;
    segs := segs || cur;
    EXIT WHEN depth = 0 OR NOT respect;
    respect := false;
  END LOOP;

  IF seps < 2 AND length(v) <= 60 THEN RETURN ARRAY[v]; END IF;
  IF seps = 0 THEN RETURN ARRAY[v]; END IF;

  FOREACH seg IN ARRAY segs LOOP
    seg := btrim(regexp_replace(btrim(seg), '^[-–•*]\s*', ''));
    seg := btrim(regexp_replace(seg, '[.]+$', ''));
    CONTINUE WHEN seg = '';
    CONTINUE WHEN lower(seg) = ANY(seen);
    seen := seen || lower(seg);
    out_arr := out_arr || seg;
  END LOOP;

  IF array_length(out_arr, 1) IS NULL THEN RETURN ARRAY[v]; END IF;
  RETURN out_arr;
END;
$$;