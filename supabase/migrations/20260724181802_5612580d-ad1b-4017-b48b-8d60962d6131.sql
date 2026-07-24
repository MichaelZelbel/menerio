CREATE OR REPLACE FUNCTION public.profile_fact_text_key(t text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public'
AS $$
  SELECT btrim(
    regexp_replace(
      regexp_replace(lower(coalesce(t, '')), '[^[:alnum:]]+', ' ', 'g'),
      '\s+',
      ' ',
      'g'
    )
  )
$$;

CREATE OR REPLACE FUNCTION public.profile_fact_label_key(t text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public'
AS $$
  SELECT public.profile_fact_text_key(public.profile_canonical_label(t))
$$;

CREATE OR REPLACE FUNCTION public.profile_value_contains_fact(superset text, subset text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public'
AS $$
  SELECT CASE
    WHEN public.profile_fact_text_key(subset) = '' THEN false
    WHEN public.profile_fact_text_key(superset) = public.profile_fact_text_key(subset) THEN true
    WHEN length(public.profile_fact_text_key(subset)) < 3 THEN false
    ELSE (' ' || public.profile_fact_text_key(superset) || ' ') LIKE ('% ' || public.profile_fact_text_key(subset) || ' %')
  END
$$;

CREATE OR REPLACE FUNCTION public.profile_entries_prevent_duplicate_fact()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_label_key text;
  v_value_key text;
  v_existing record;
BEGIN
  IF NEW.value IS NULL OR btrim(NEW.value) = '' THEN
    RETURN NEW;
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
     AND (
       public.profile_value_contains_fact(value, NEW.value)
       OR public.profile_value_contains_fact(NEW.value, value)
     )
   ORDER BY
     CASE WHEN public.profile_value_contains_fact(value, NEW.value) THEN 0 ELSE 1 END,
     length(public.profile_fact_text_key(value)) DESC,
     COALESCE(is_pinned, false) DESC,
     created_at ASC,
     id ASC
   LIMIT 1
   FOR UPDATE;

  IF FOUND THEN
    IF TG_OP = 'INSERT' THEN
      IF public.profile_value_contains_fact(v_existing.value, NEW.value) THEN
        UPDATE public.profile_entries
           SET linked_note_id = COALESCE(public.profile_entries.linked_note_id, NEW.linked_note_id),
               updated_at = now()
         WHERE id = v_existing.id;
      ELSE
        UPDATE public.profile_entries
           SET value = NEW.value,
               linked_note_id = COALESCE(public.profile_entries.linked_note_id, NEW.linked_note_id),
               updated_at = now()
         WHERE id = v_existing.id;
      END IF;
    END IF;
    RETURN NULL;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_profile_entries_dedup_before_insert ON public.profile_entries;
DROP TRIGGER IF EXISTS trg_profile_entries_prevent_duplicate_fact ON public.profile_entries;

CREATE TRIGGER trg_profile_entries_prevent_duplicate_fact
BEFORE INSERT OR UPDATE OF user_id, contact_id, label, value
ON public.profile_entries
FOR EACH ROW
EXECUTE FUNCTION public.profile_entries_prevent_duplicate_fact();

GRANT EXECUTE ON FUNCTION public.profile_fact_text_key(text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.profile_fact_label_key(text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.profile_value_contains_fact(text, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.profile_entries_prevent_duplicate_fact() TO authenticated, service_role;