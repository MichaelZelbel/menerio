-- Add merged_into column to contacts for duplicate resolution
ALTER TABLE public.contacts
  ADD COLUMN merged_into uuid REFERENCES public.contacts(id) ON DELETE SET NULL,
  ADD COLUMN merged_at timestamp with time zone;

-- Index for filtering out merged contacts
CREATE INDEX idx_contacts_merged_into ON public.contacts (user_id, merged_into)
  WHERE merged_into IS NULL;