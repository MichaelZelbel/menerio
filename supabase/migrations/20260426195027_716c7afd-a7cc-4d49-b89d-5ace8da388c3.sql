CREATE TABLE public.wiki_pages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  slug text NOT NULL,
  title text NOT NULL,
  page_type text NOT NULL DEFAULT 'concept' CHECK (page_type IN ('entity', 'concept', 'source', 'overview', 'synthesis', 'person')),
  content text NOT NULL DEFAULT '',
  summary text,
  source_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT wiki_pages_user_slug_key UNIQUE (user_id, slug)
);

CREATE INDEX idx_wiki_pages_user_id ON public.wiki_pages (user_id);
CREATE INDEX idx_wiki_pages_user_page_type ON public.wiki_pages (user_id, page_type);
CREATE INDEX idx_wiki_pages_user_updated_at ON public.wiki_pages (user_id, updated_at DESC);

ALTER TABLE public.wiki_pages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own wiki pages"
ON public.wiki_pages
FOR SELECT
TO authenticated
USING (auth.uid() = user_id);

CREATE POLICY "Users can create own wiki pages"
ON public.wiki_pages
FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own wiki pages"
ON public.wiki_pages
FOR UPDATE
TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own wiki pages"
ON public.wiki_pages
FOR DELETE
TO authenticated
USING (auth.uid() = user_id);

CREATE TRIGGER update_wiki_pages_updated_at
BEFORE UPDATE ON public.wiki_pages
FOR EACH ROW
EXECUTE FUNCTION public.handle_updated_at();

CREATE TABLE public.wiki_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  source_page_id uuid NOT NULL REFERENCES public.wiki_pages(id) ON DELETE CASCADE,
  target_slug text NOT NULL,
  target_page_id uuid REFERENCES public.wiki_pages(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_wiki_links_user_target_slug ON public.wiki_links (user_id, target_slug);
CREATE INDEX idx_wiki_links_source_page_id ON public.wiki_links (source_page_id);

ALTER TABLE public.wiki_links ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own wiki links"
ON public.wiki_links
FOR SELECT
TO authenticated
USING (auth.uid() = user_id);

CREATE POLICY "Users can create own wiki links"
ON public.wiki_links
FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own wiki links"
ON public.wiki_links
FOR UPDATE
TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own wiki links"
ON public.wiki_links
FOR DELETE
TO authenticated
USING (auth.uid() = user_id);

CREATE TABLE public.wiki_page_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  wiki_page_id uuid NOT NULL REFERENCES public.wiki_pages(id) ON DELETE CASCADE,
  note_id uuid NOT NULL REFERENCES public.notes(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT wiki_page_sources_page_note_key UNIQUE (wiki_page_id, note_id)
);

ALTER TABLE public.wiki_page_sources ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own wiki page sources"
ON public.wiki_page_sources
FOR SELECT
TO authenticated
USING (auth.uid() = user_id);

CREATE POLICY "Users can create own wiki page sources"
ON public.wiki_page_sources
FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own wiki page sources"
ON public.wiki_page_sources
FOR UPDATE
TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own wiki page sources"
ON public.wiki_page_sources
FOR DELETE
TO authenticated
USING (auth.uid() = user_id);

CREATE TABLE public.wiki_revisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  wiki_page_id uuid REFERENCES public.wiki_pages(id) ON DELETE SET NULL,
  page_slug text NOT NULL,
  page_title text NOT NULL,
  change_type text NOT NULL CHECK (change_type IN ('created', 'updated', 'manual_edit', 'rolled_back')),
  previous_content text,
  new_content text NOT NULL,
  change_summary text,
  source_note_id uuid REFERENCES public.notes(id) ON DELETE SET NULL,
  source_revision_id uuid REFERENCES public.wiki_revisions(id),
  status text NOT NULL DEFAULT 'applied' CHECK (status IN ('applied', 'reviewed', 'rolled_back')),
  reviewed_at timestamptz,
  rolled_back_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_wiki_revisions_user_status_created_at ON public.wiki_revisions (user_id, status, created_at DESC);
CREATE INDEX idx_wiki_revisions_page_created_at ON public.wiki_revisions (wiki_page_id, created_at DESC);

ALTER TABLE public.wiki_revisions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own wiki revisions"
ON public.wiki_revisions
FOR SELECT
TO authenticated
USING (auth.uid() = user_id);

CREATE POLICY "Users can create own wiki revisions"
ON public.wiki_revisions
FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own wiki revisions"
ON public.wiki_revisions
FOR UPDATE
TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own wiki revisions"
ON public.wiki_revisions
FOR DELETE
TO authenticated
USING (auth.uid() = user_id);

CREATE TABLE public.wiki_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  operation text NOT NULL CHECK (operation IN ('ingest', 'ingest_skipped', 'ingest_failed', 'lint', 'lint_failed')),
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_wiki_log_user_created_at ON public.wiki_log (user_id, created_at DESC);

ALTER TABLE public.wiki_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own wiki log"
ON public.wiki_log
FOR SELECT
TO authenticated
USING (auth.uid() = user_id);

CREATE POLICY "Users can create own wiki log"
ON public.wiki_log
FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own wiki log"
ON public.wiki_log
FOR UPDATE
TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own wiki log"
ON public.wiki_log
FOR DELETE
TO authenticated
USING (auth.uid() = user_id);

CREATE OR REPLACE FUNCTION public.wiki_resync_links(p_page_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid;
  v_content text;
BEGIN
  SELECT user_id, content
  INTO v_user_id, v_content
  FROM public.wiki_pages
  WHERE id = p_page_id;

  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'wiki page not found';
  END IF;

  IF auth.uid() IS NULL OR auth.uid() <> v_user_id THEN
    RAISE EXCEPTION 'not authorized';
  END IF;

  DELETE FROM public.wiki_links
  WHERE source_page_id = p_page_id;

  INSERT INTO public.wiki_links (user_id, source_page_id, target_slug, target_page_id)
  SELECT
    v_user_id,
    p_page_id,
    matches.target_slug,
    target.id
  FROM regexp_matches(COALESCE(v_content, ''), '\[\[([a-z0-9-]+)\]\]', 'g') AS match(slug_parts)
  CROSS JOIN LATERAL (SELECT match.slug_parts[1] AS target_slug) AS matches
  LEFT JOIN public.wiki_pages target
    ON target.user_id = v_user_id
   AND target.slug = matches.target_slug;
END;
$$;

REVOKE ALL ON FUNCTION public.wiki_resync_links(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.wiki_resync_links(uuid) TO authenticated;