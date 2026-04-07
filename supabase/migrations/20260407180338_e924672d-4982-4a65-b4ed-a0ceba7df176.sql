
ALTER TABLE public.contacts
  ADD COLUMN IF NOT EXISTS aliases text[] DEFAULT '{}'::text[],
  ADD COLUMN IF NOT EXISTS app_mappings jsonb DEFAULT '{}'::jsonb;
