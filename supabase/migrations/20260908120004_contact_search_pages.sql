-- Scalar JSON avoids PostgREST row caps truncating an individual contact page.
-- SECURITY INVOKER preserves RLS, with an explicit owner filter as defense in depth.
CREATE OR REPLACE FUNCTION public.search_contacts_page(
  search_text text DEFAULT '', after_name text DEFAULT NULL,
  after_id uuid DEFAULT NULL, page_size integer DEFAULT 50
) RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$
  WITH matches AS MATERIALIZED (
    SELECT c.* FROM public.contacts c
    WHERE c.user_id = auth.uid() AND c.merged_into IS NULL
      AND (coalesce(trim(search_text),'') = ''
        OR strpos(lower(c.name),lower(trim(search_text))) > 0
        OR EXISTS (SELECT 1 FROM unnest(c.aliases) alias
          WHERE strpos(lower(alias),lower(trim(search_text))) > 0))
  ), page AS MATERIALIZED (
    SELECT * FROM matches
    WHERE after_name IS NULL OR after_id IS NULL OR (name,id) > (after_name,after_id)
    ORDER BY name,id LIMIT greatest(1,least(coalesce(page_size,50),100))
  )
  SELECT jsonb_build_object(
    'rows',coalesce((SELECT jsonb_agg(to_jsonb(p) ORDER BY name,id) FROM page p),'[]'::jsonb),
    'total',(SELECT count(*) FROM matches),
    'next', (SELECT jsonb_build_object('name',p.name,'id',p.id) FROM page p
      WHERE EXISTS (SELECT 1 FROM matches m WHERE (m.name,m.id) > (p.name,p.id))
      AND (p.name,p.id) = (SELECT name,id FROM page ORDER BY name DESC,id DESC LIMIT 1)
      LIMIT 1)
  );
$$;
REVOKE ALL ON FUNCTION public.search_contacts_page(text,text,uuid,integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.search_contacts_page(text,text,uuid,integer) TO authenticated;
CREATE INDEX IF NOT EXISTS contacts_active_name_id ON public.contacts(user_id,name,id) WHERE merged_into IS NULL;
