-- Drop existing unique constraint on (user_id, slug) if it exists
DO $$
BEGIN
  -- Try dropping common constraint names
  ALTER TABLE public.profile_categories DROP CONSTRAINT IF EXISTS profile_categories_user_id_slug_key;
  ALTER TABLE public.profile_categories DROP CONSTRAINT IF EXISTS profile_categories_user_slug_unique;
  -- Drop any unique index on (user_id, slug)
  DROP INDEX IF EXISTS profile_categories_user_id_slug_key;
  DROP INDEX IF EXISTS profile_categories_user_slug_unique;
  DROP INDEX IF EXISTS profile_categories_user_id_slug_idx;
END $$;

-- Create new unique index that includes contact_id
CREATE UNIQUE INDEX profile_categories_user_contact_slug_idx
ON public.profile_categories (user_id, COALESCE(contact_id, '00000000-0000-0000-0000-000000000000'::uuid), slug);