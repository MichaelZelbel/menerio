REVOKE ALL ON FUNCTION public.wiki_resync_links(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.wiki_resync_links(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.wiki_resync_links(uuid) TO authenticated;