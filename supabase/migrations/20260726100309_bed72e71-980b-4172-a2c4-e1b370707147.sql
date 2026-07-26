ALTER TABLE public.wiki_revisions DROP CONSTRAINT wiki_revisions_change_type_check;
ALTER TABLE public.wiki_revisions ADD CONSTRAINT wiki_revisions_change_type_check
  CHECK (change_type = ANY (ARRAY['created'::text, 'updated'::text, 'manual_edit'::text, 'rolled_back'::text, 'restructured'::text]));