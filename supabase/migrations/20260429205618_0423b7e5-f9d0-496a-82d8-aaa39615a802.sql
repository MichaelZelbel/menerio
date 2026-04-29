CREATE OR REPLACE FUNCTION public.increment_collection_template_usage(p_slug text)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  UPDATE public.collection_templates
  SET usage_count = usage_count + 1
  WHERE slug = p_slug;
$$;

REVOKE ALL ON FUNCTION public.increment_collection_template_usage(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.increment_collection_template_usage(text) TO authenticated;