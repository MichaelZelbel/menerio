-- Create the contact_relationships table
CREATE TABLE public.contact_relationships (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL DEFAULT auth.uid(),
  source_type text NOT NULL CHECK (source_type IN ('contact', 'self')),
  source_id uuid REFERENCES public.contacts(id) ON DELETE CASCADE,
  target_type text NOT NULL CHECK (target_type IN ('contact', 'self')),
  target_id uuid REFERENCES public.contacts(id) ON DELETE CASCADE,
  label text NOT NULL,
  custom_label text,
  inverse_id uuid REFERENCES public.contact_relationships(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  -- Ensure source_id is set when source_type='contact' and null when 'self'
  CONSTRAINT chk_source CHECK (
    (source_type = 'contact' AND source_id IS NOT NULL) OR
    (source_type = 'self' AND source_id IS NULL)
  ),
  CONSTRAINT chk_target CHECK (
    (target_type = 'contact' AND target_id IS NOT NULL) OR
    (target_type = 'self' AND target_id IS NULL)
  ),
  -- Prevent self-to-self relationships
  CONSTRAINT chk_not_self_to_self CHECK (
    NOT (source_type = 'self' AND target_type = 'self')
  )
);

-- Unique constraint: no duplicate relationships between the same pair with the same label
CREATE UNIQUE INDEX uq_contact_relationship ON public.contact_relationships (
  user_id,
  source_type,
  COALESCE(source_id, '00000000-0000-0000-0000-000000000000'),
  target_type,
  COALESCE(target_id, '00000000-0000-0000-0000-000000000000'),
  label
);

-- Index for fast lookups by contact
CREATE INDEX idx_cr_source ON public.contact_relationships (user_id, source_type, source_id);
CREATE INDEX idx_cr_target ON public.contact_relationships (user_id, target_type, target_id);

-- Enable RLS
ALTER TABLE public.contact_relationships ENABLE ROW LEVEL SECURITY;

-- RLS policy: users can manage their own relationships
CREATE POLICY "Users can manage own relationships"
  ON public.contact_relationships
  FOR ALL
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- Auto-update updated_at
CREATE TRIGGER update_contact_relationships_updated_at
  BEFORE UPDATE ON public.contact_relationships
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_updated_at();