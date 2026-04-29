CREATE OR REPLACE FUNCTION public.set_collection_slug()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_base_slug text;
  v_candidate text;
BEGIN
  v_base_slug := CASE
    WHEN NEW.slug IS NULL OR btrim(NEW.slug) = '' THEN public.slugify_collection_name(NEW.name)
    ELSE public.slugify_collection_name(NEW.slug)
  END;

  v_candidate := v_base_slug;

  WHILE EXISTS (
    SELECT 1 FROM public.collections
    WHERE user_id = NEW.user_id
      AND slug = v_candidate
      AND id IS DISTINCT FROM NEW.id
  ) LOOP
    v_candidate := v_base_slug || '-' || lower(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6));
  END LOOP;

  NEW.slug := v_candidate;
  RETURN NEW;
END;
$$;