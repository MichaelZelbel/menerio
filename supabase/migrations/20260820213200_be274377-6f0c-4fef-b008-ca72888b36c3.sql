-- Atomizer: one profile row = one fact.
-- Splits multi-fact values into sibling rows at write time so EVERY writer
-- (AI extraction, imports, MCP, review queue, UI) produces atomic rows.

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
BEGIN
  IF v = '' THEN RETURN ARRAY[]::text[]; END IF;
  -- Prose labels are never split.
  IF lbl IN ('professional summary','self description','how we met','bio','note','summary') THEN
    RETURN ARRAY[v];
  END IF;

  FOR i IN 1..length(v) LOOP
    ch := substr(v, i, 1);
    IF ch IN ('(', '[') THEN depth := depth + 1;
    ELSIF ch IN (')', ']') THEN depth := greatest(0, depth - 1);
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

  -- A single separator in a short value is a qualifier ("São Paulo, Brazil").
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

CREATE OR REPLACE FUNCTION public.profile_entries_atomize()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  parts text[];
  i int;
BEGIN
  IF NEW.value IS NULL OR btrim(NEW.value) = '' THEN
    RETURN NEW;
  END IF;

  parts := public.profile_split_fact_value(NEW.label, NEW.value);
  IF array_length(parts, 1) IS NULL THEN
    RETURN NEW;
  END IF;

  -- Sibling rows for facts 2..n. Each insert re-enters the trigger chain, so
  -- canonicalization, dedup and quality guards still apply to every sibling.
  IF array_length(parts, 1) > 1 THEN
    FOR i IN 2..array_length(parts, 1) LOOP
      BEGIN
        INSERT INTO public.profile_entries (
          user_id, contact_id, category_id, label, value,
          linked_note_id, origin, evidence_quote, sort_order
        ) VALUES (
          NEW.user_id, NEW.contact_id, NEW.category_id, NEW.label, parts[i],
          NEW.linked_note_id, NEW.origin, NEW.evidence_quote, NEW.sort_order
        );
      EXCEPTION WHEN OTHERS THEN
        -- A sibling blocked by the dedup/quality guards is expected and must
        -- not abort the caller's write.
        NULL;
      END;
    END LOOP;
  END IF;

  NEW.value := parts[1];
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_a_profile_entries_atomize ON public.profile_entries;
CREATE TRIGGER trg_a_profile_entries_atomize
BEFORE INSERT ON public.profile_entries
FOR EACH ROW EXECUTE FUNCTION public.profile_entries_atomize();