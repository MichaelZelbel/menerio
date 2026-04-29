DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'contact_group_memberships_person_id_fkey'
      AND conrelid = 'public.contact_group_memberships'::regclass
  ) AND NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'contact_group_memberships_contact_id_fkey'
      AND conrelid = 'public.contact_group_memberships'::regclass
  ) THEN
    ALTER TABLE public.contact_group_memberships
    RENAME CONSTRAINT contact_group_memberships_person_id_fkey TO contact_group_memberships_contact_id_fkey;
  END IF;
END $$;