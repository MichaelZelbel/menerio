ALTER TABLE public.contacts
  ADD COLUMN IF NOT EXISTS entity_kind text,
  ADD COLUMN IF NOT EXISTS entity_confidence double precision,
  ADD COLUMN IF NOT EXISTS entity_reason text,
  ADD COLUMN IF NOT EXISTS entity_classified_at timestamptz;

CREATE TABLE public.relationship_evidence (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  relationship_id uuid REFERENCES public.contact_relationships(id) ON DELETE CASCADE,
  source_note_id uuid REFERENCES public.notes(id) ON DELETE CASCADE,
  source_quote text NOT NULL,
  source_context text,
  proposed_label text NOT NULL,
  adjudicated_label text,
  outcome text NOT NULL,
  reason text NOT NULL,
  real_person_a boolean,
  real_person_b boolean,
  personally_relevant boolean,
  relationship_supported boolean,
  incidental_or_transactional boolean,
  fictional_or_roleplay boolean,
  same_as_relationship_id uuid REFERENCES public.contact_relationships(id) ON DELETE SET NULL,
  confidence double precision NOT NULL DEFAULT 0,
  adjudication_version text NOT NULL,
  note_content_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, source_note_id, proposed_label, note_content_hash, source_quote)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.relationship_evidence TO authenticated;
GRANT ALL ON public.relationship_evidence TO service_role;
ALTER TABLE public.relationship_evidence ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own relationship evidence"
  ON public.relationship_evidence FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE INDEX idx_relationship_evidence_relationship ON public.relationship_evidence (user_id, relationship_id);
CREATE INDEX idx_relationship_evidence_note ON public.relationship_evidence (user_id, source_note_id);
CREATE INDEX idx_relationship_evidence_outcome ON public.relationship_evidence (user_id, outcome);
CREATE TRIGGER update_relationship_evidence_updated_at
  BEFORE UPDATE ON public.relationship_evidence
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

CREATE TABLE public.relationship_repair_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  cursor_created_at timestamptz,
  cursor_id uuid,
  total_relationships integer NOT NULL DEFAULT 0,
  processed_relationships integer NOT NULL DEFAULT 0,
  kept_count integer NOT NULL DEFAULT 0,
  removed_count integer NOT NULL DEFAULT 0,
  merged_count integer NOT NULL DEFAULT 0,
  relabeled_count integer NOT NULL DEFAULT 0,
  queued_count integer NOT NULL DEFAULT 0,
  failed_count integer NOT NULL DEFAULT 0,
  summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.relationship_repair_runs TO authenticated;
GRANT ALL ON public.relationship_repair_runs TO service_role;
ALTER TABLE public.relationship_repair_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own relationship repair runs"
  ON public.relationship_repair_runs FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX idx_relationship_repair_runs_user_status ON public.relationship_repair_runs (user_id, status, created_at DESC);
CREATE TRIGGER update_relationship_repair_runs_updated_at
  BEFORE UPDATE ON public.relationship_repair_runs
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

CREATE TABLE public.relationship_repair_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES public.relationship_repair_runs(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  relationship_id uuid,
  source_note_id uuid REFERENCES public.notes(id) ON DELETE SET NULL,
  person_a text NOT NULL,
  person_b text NOT NULL,
  old_label text NOT NULL,
  outcome text NOT NULL,
  new_label text,
  reason text NOT NULL,
  evidence_quote text,
  confidence double precision,
  snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (run_id, relationship_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.relationship_repair_items TO authenticated;
GRANT ALL ON public.relationship_repair_items TO service_role;
ALTER TABLE public.relationship_repair_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own relationship repair items"
  ON public.relationship_repair_items FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX idx_relationship_repair_items_run ON public.relationship_repair_items (run_id, created_at);
CREATE INDEX idx_relationship_repair_items_outcome ON public.relationship_repair_items (user_id, outcome);

ALTER TABLE public.contacts
  DROP CONSTRAINT IF EXISTS contacts_entity_kind_valid;
ALTER TABLE public.contacts
  ADD CONSTRAINT contacts_entity_kind_valid CHECK (
    entity_kind IS NULL OR entity_kind IN ('real_person', 'public_person', 'organization', 'product', 'fictional_character', 'avatar', 'role', 'unclear')
  );