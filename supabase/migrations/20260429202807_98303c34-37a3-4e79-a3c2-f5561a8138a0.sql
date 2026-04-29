CREATE OR REPLACE FUNCTION public.validate_collection_item_data()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_schema jsonb;
  v_field jsonb;
  v_key text;
  v_type text;
  v_value jsonb;
  v_text text;
  v_has_primary boolean := false;
BEGIN
  IF jsonb_typeof(NEW.data) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'collection item data must be an object';
  END IF;

  SELECT field_schema INTO v_schema
  FROM public.collections
  WHERE id = NEW.collection_id
    AND user_id = NEW.user_id;

  IF v_schema IS NULL THEN
    RAISE EXCEPTION 'collection not found for item';
  END IF;

  FOR v_field IN SELECT * FROM jsonb_array_elements(v_schema)
  LOOP
    v_key := v_field->>'key';
    v_type := COALESCE(v_field->>'type', 'text');

    IF v_key IS NULL OR v_key = '' THEN
      CONTINUE;
    END IF;

    v_value := NEW.data -> v_key;
    v_text := NULLIF(trim(BOTH '"' FROM COALESCE(v_value::text, 'null')), 'null');
    v_text := NULLIF(btrim(COALESCE(v_text, '')), '');

    IF COALESCE((v_field->>'primary')::boolean, false) THEN
      v_has_primary := true;
      IF v_text IS NULL THEN
        RAISE EXCEPTION 'primary field cannot be empty';
      END IF;
    END IF;

    IF v_value IS NULL OR v_value = 'null'::jsonb OR v_text IS NULL THEN
      CONTINUE;
    END IF;

    IF v_type IN ('number', 'currency') THEN
      BEGIN
        PERFORM v_text::numeric;
      EXCEPTION WHEN OTHERS THEN
        RAISE EXCEPTION 'field % must be numeric', v_key;
      END;
    ELSIF v_type = 'url' THEN
      IF v_text !~* '^https?://[^[:space:]]+\.[^[:space:]]+' THEN
        RAISE EXCEPTION 'field % must be a valid URL', v_key;
      END IF;
    ELSIF v_type = 'email' THEN
      IF v_text !~* '^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$' THEN
        RAISE EXCEPTION 'field % must be a valid email address', v_key;
      END IF;
    ELSIF v_type = 'multiselect' THEN
      IF jsonb_typeof(v_value) <> 'array' THEN
        RAISE EXCEPTION 'field % must be a list', v_key;
      END IF;
    ELSIF v_type = 'boolean' THEN
      IF jsonb_typeof(v_value) <> 'boolean' THEN
        RAISE EXCEPTION 'field % must be true or false', v_key;
      END IF;
    END IF;
  END LOOP;

  IF NOT v_has_primary THEN
    RAISE EXCEPTION 'collection schema must include a primary field';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS validate_collection_item_data_before_write ON public.collection_items;
CREATE TRIGGER validate_collection_item_data_before_write
BEFORE INSERT OR UPDATE ON public.collection_items
FOR EACH ROW
EXECUTE FUNCTION public.validate_collection_item_data();