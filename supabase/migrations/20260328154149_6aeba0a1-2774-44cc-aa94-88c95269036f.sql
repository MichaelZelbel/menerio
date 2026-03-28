
-- Add new columns for cross-app integration
ALTER TABLE public.notes
  ADD COLUMN IF NOT EXISTS entity_type text,
  ADD COLUMN IF NOT EXISTS related jsonb DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS source_app text,
  ADD COLUMN IF NOT EXISTS source_id text,
  ADD COLUMN IF NOT EXISTS source_url text,
  ADD COLUMN IF NOT EXISTS structured_fields jsonb DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS is_external boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS sync_status text DEFAULT 'synced';

-- Create indices
CREATE INDEX IF NOT EXISTS idx_notes_user_id ON public.notes (user_id);
CREATE INDEX IF NOT EXISTS idx_notes_tags ON public.notes USING gin (tags);
CREATE INDEX IF NOT EXISTS idx_notes_content_fts ON public.notes USING gin (to_tsvector('german', content));
CREATE INDEX IF NOT EXISTS idx_notes_source ON public.notes (source_app, source_id);
CREATE INDEX IF NOT EXISTS idx_notes_entity_type ON public.notes (entity_type);

-- Create updated_at trigger (reusing existing function)
DROP TRIGGER IF EXISTS set_notes_updated_at ON public.notes;
CREATE TRIGGER set_notes_updated_at
  BEFORE UPDATE ON public.notes
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_updated_at();
