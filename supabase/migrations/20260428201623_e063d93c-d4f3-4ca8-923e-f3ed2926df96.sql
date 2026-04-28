ALTER TABLE public.wiki_pages
ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
ADD COLUMN IF NOT EXISTS last_synthesized_at timestamp with time zone;

DO $$
DECLARE
  constraint_name text;
BEGIN
  SELECT con.conname
  INTO constraint_name
  FROM pg_constraint con
  JOIN pg_class rel ON rel.oid = con.conrelid
  JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
  WHERE nsp.nspname = 'public'
    AND rel.relname = 'wiki_pages'
    AND con.contype = 'c'
    AND pg_get_constraintdef(con.oid) ILIKE '%page_type%'
  LIMIT 1;

  IF constraint_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.wiki_pages DROP CONSTRAINT %I', constraint_name);
  END IF;

  ALTER TABLE public.wiki_pages
    ADD CONSTRAINT wiki_pages_page_type_check
    CHECK (page_type IN ('entity', 'concept', 'source', 'overview', 'synthesis', 'person', 'group'));
END $$;

CREATE INDEX IF NOT EXISTS idx_wiki_pages_user_metadata_group_id
ON public.wiki_pages ((metadata->>'group_id'))
WHERE page_type = 'group';

CREATE INDEX IF NOT EXISTS idx_wiki_pages_group_synthesis
ON public.wiki_pages (user_id, page_type, last_synthesized_at)
WHERE page_type = 'group';