-- Create contact groups for grouping people
CREATE TABLE public.contact_groups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL,
  slug text NOT NULL,
  description text,
  purpose text,
  type text NOT NULL DEFAULT 'other',
  template text,
  success_criteria jsonb NOT NULL DEFAULT '[]'::jsonb,
  stages jsonb NOT NULL DEFAULT '[]'::jsonb,
  attributes_schema jsonb NOT NULL DEFAULT '{}'::jsonb,
  sensitivity text NOT NULL DEFAULT 'normal',
  icon text,
  color text,
  is_trashed boolean NOT NULL DEFAULT false,
  archived_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT contact_groups_user_slug_key UNIQUE (user_id, slug),
  CONSTRAINT contact_groups_type_check CHECK (type IN ('outreach', 'relationship_care', 'sales', 'investors', 'hiring', 'research', 'community', 'learning', 'creators', 'other')),
  CONSTRAINT contact_groups_sensitivity_check CHECK (sensitivity IN ('normal', 'sensitive')),
  CONSTRAINT contact_groups_success_criteria_array_check CHECK (jsonb_typeof(success_criteria) = 'array'),
  CONSTRAINT contact_groups_stages_array_check CHECK (jsonb_typeof(stages) = 'array'),
  CONSTRAINT contact_groups_attributes_schema_object_check CHECK (jsonb_typeof(attributes_schema) = 'object')
);

-- Create memberships between groups and people
CREATE TABLE public.contact_group_memberships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id uuid NOT NULL REFERENCES public.contact_groups(id) ON DELETE CASCADE,
  person_id uuid NOT NULL REFERENCES public.contacts(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status text,
  priority text NOT NULL DEFAULT 'normal',
  position integer NOT NULL DEFAULT 0,
  reason text,
  notes text,
  attributes jsonb NOT NULL DEFAULT '{}'::jsonb,
  source_note_ids uuid[] NOT NULL DEFAULT '{}'::uuid[],
  joined_at timestamptz NOT NULL DEFAULT now(),
  last_movement_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT contact_group_memberships_group_person_key UNIQUE (group_id, person_id),
  CONSTRAINT contact_group_memberships_priority_check CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
  CONSTRAINT contact_group_memberships_attributes_object_check CHECK (jsonb_typeof(attributes) = 'object')
);

-- Extend contact interactions with optional group context
ALTER TABLE public.contact_interactions
ADD COLUMN group_id uuid REFERENCES public.contact_groups(id) ON DELETE SET NULL;

-- If wiki_pages has a page_type CHECK constraint, replace it with one that includes group.
DO $$
DECLARE
  constraint_name text;
BEGIN
  SELECT con.conname INTO constraint_name
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
    ALTER TABLE public.wiki_pages
      ADD CONSTRAINT wiki_pages_page_type_check
      CHECK (page_type IN ('entity', 'concept', 'source', 'overview', 'synthesis', 'person', 'group'));
  END IF;
END $$;

-- Enable RLS
ALTER TABLE public.contact_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contact_group_memberships ENABLE ROW LEVEL SECURITY;

-- RLS policies for contact_groups
CREATE POLICY "Users can view their own contact groups"
ON public.contact_groups
FOR SELECT
TO authenticated
USING (auth.uid() = user_id);

CREATE POLICY "Users can create their own contact groups"
ON public.contact_groups
FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own contact groups"
ON public.contact_groups
FOR UPDATE
TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete their own contact groups"
ON public.contact_groups
FOR DELETE
TO authenticated
USING (auth.uid() = user_id);

-- RLS policies for contact_group_memberships
CREATE POLICY "Users can view their own contact group memberships"
ON public.contact_group_memberships
FOR SELECT
TO authenticated
USING (auth.uid() = user_id);

CREATE POLICY "Users can create their own contact group memberships"
ON public.contact_group_memberships
FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own contact group memberships"
ON public.contact_group_memberships
FOR UPDATE
TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete their own contact group memberships"
ON public.contact_group_memberships
FOR DELETE
TO authenticated
USING (auth.uid() = user_id);

-- Keep updated_at fresh
CREATE TRIGGER update_contact_groups_updated_at
BEFORE UPDATE ON public.contact_groups
FOR EACH ROW
EXECUTE FUNCTION public.handle_updated_at();

CREATE TRIGGER update_contact_group_memberships_updated_at
BEFORE UPDATE ON public.contact_group_memberships
FOR EACH ROW
EXECUTE FUNCTION public.handle_updated_at();

-- Track movement when membership status changes
CREATE OR REPLACE FUNCTION public.handle_contact_group_membership_status_movement()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    NEW.last_movement_at = now();
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER update_contact_group_memberships_last_movement_at
BEFORE UPDATE OF status ON public.contact_group_memberships
FOR EACH ROW
EXECUTE FUNCTION public.handle_contact_group_membership_status_movement();

-- Indexes
CREATE INDEX idx_contact_groups_user_trashed ON public.contact_groups (user_id, is_trashed);
CREATE INDEX idx_contact_group_memberships_group_status_position ON public.contact_group_memberships (group_id, status, position);
CREATE INDEX idx_contact_group_memberships_person ON public.contact_group_memberships (person_id);
CREATE INDEX idx_contact_group_memberships_user ON public.contact_group_memberships (user_id);
CREATE INDEX idx_contact_interactions_group ON public.contact_interactions (group_id);