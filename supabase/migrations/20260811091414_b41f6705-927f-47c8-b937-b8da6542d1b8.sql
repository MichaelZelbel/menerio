-- ENTITIES ------------------------------------------------------------------
CREATE TABLE public.entities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid(),
  name text NOT NULL,
  aliases text[] NOT NULL DEFAULT '{}',
  entity_type text NOT NULL DEFAULT 'other',
  description text,
  tags text[] NOT NULL DEFAULT '{}',
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  ai_visibility text NOT NULL DEFAULT 'visible',
  is_sensitive boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.entities TO authenticated;
GRANT ALL ON public.entities TO service_role;
ALTER TABLE public.entities ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own entities" ON public.entities
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users can create their own entities" ON public.entities
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update their own entities" ON public.entities
  FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can delete their own entities" ON public.entities
  FOR DELETE TO authenticated USING (auth.uid() = user_id);

CREATE TRIGGER entities_updated_at BEFORE UPDATE ON public.entities
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

CREATE INDEX idx_entities_user_type ON public.entities (user_id, entity_type);
CREATE INDEX idx_entities_user_name ON public.entities (user_id, lower(name));

-- CLAIMS --------------------------------------------------------------------
CREATE TABLE public.claims (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid(),
  subject_type text NOT NULL CHECK (subject_type IN ('self', 'contact', 'entity')),
  subject_id uuid,
  attribute text NOT NULL,
  value text NOT NULL,
  value_json jsonb,
  valid_from date,
  valid_to date,
  confidence text NOT NULL DEFAULT 'likely' CHECK (confidence IN ('certain', 'likely', 'unsure')),
  source_type text CHECK (source_type IN ('note', 'moment', 'manual', 'ai')),
  source_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT claims_subject_pair CHECK (
    (subject_type = 'self' AND subject_id IS NULL)
    OR (subject_type <> 'self' AND subject_id IS NOT NULL)
  )
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.claims TO authenticated;
GRANT ALL ON public.claims TO service_role;
ALTER TABLE public.claims ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own claims" ON public.claims
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users can create their own claims" ON public.claims
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update their own claims" ON public.claims
  FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can delete their own claims" ON public.claims
  FOR DELETE TO authenticated USING (auth.uid() = user_id);

CREATE TRIGGER claims_updated_at BEFORE UPDATE ON public.claims
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

CREATE INDEX idx_claims_subject ON public.claims (user_id, subject_type, subject_id);
CREATE INDEX idx_claims_attribute ON public.claims (user_id, attribute);
CREATE INDEX idx_claims_valid_to ON public.claims (user_id, valid_to);

-- MOMENT <-> ENTITY LINKS ----------------------------------------------------
CREATE TABLE public.moment_entities (
  moment_id uuid NOT NULL REFERENCES public.moments(id) ON DELETE CASCADE,
  entity_id uuid NOT NULL REFERENCES public.entities(id) ON DELETE CASCADE,
  user_id uuid NOT NULL DEFAULT auth.uid(),
  role text,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (moment_id, entity_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.moment_entities TO authenticated;
GRANT ALL ON public.moment_entities TO service_role;
ALTER TABLE public.moment_entities ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own moment entity links" ON public.moment_entities
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users can create their own moment entity links" ON public.moment_entities
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update their own moment entity links" ON public.moment_entities
  FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can delete their own moment entity links" ON public.moment_entities
  FOR DELETE TO authenticated USING (auth.uid() = user_id);

CREATE INDEX idx_moment_entities_entity ON public.moment_entities (user_id, entity_id);

-- ADDITIVE COLUMNS -----------------------------------------------------------
ALTER TABLE public.contact_relationships
  ADD COLUMN IF NOT EXISTS valid_from date,
  ADD COLUMN IF NOT EXISTS valid_to date;

ALTER TABLE public.collection_items
  ADD COLUMN IF NOT EXISTS entity_id uuid REFERENCES public.entities(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS contact_id uuid REFERENCES public.contacts(id) ON DELETE SET NULL;