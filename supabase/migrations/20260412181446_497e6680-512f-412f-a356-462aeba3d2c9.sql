-- Add contact_id to profile_categories
ALTER TABLE public.profile_categories
  ADD COLUMN contact_id uuid REFERENCES public.contacts(id) ON DELETE CASCADE DEFAULT NULL;

-- Add contact_id to profile_entries
ALTER TABLE public.profile_entries
  ADD COLUMN contact_id uuid REFERENCES public.contacts(id) ON DELETE CASCADE DEFAULT NULL;

-- Index for efficient lookup
CREATE INDEX idx_profile_categories_contact ON public.profile_categories(contact_id) WHERE contact_id IS NOT NULL;
CREATE INDEX idx_profile_entries_contact ON public.profile_entries(contact_id) WHERE contact_id IS NOT NULL;