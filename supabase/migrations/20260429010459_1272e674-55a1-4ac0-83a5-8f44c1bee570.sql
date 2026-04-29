DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'contact_groups_user_id_profiles_fkey'
  ) THEN
    ALTER TABLE public.contact_groups
    ADD CONSTRAINT contact_groups_user_id_profiles_fkey
    FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'contact_group_memberships_user_id_profiles_fkey'
  ) THEN
    ALTER TABLE public.contact_group_memberships
    ADD CONSTRAINT contact_group_memberships_user_id_profiles_fkey
    FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE NOT VALID;
  END IF;
END $$;