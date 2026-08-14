ALTER TABLE public.notes
  ADD COLUMN IF NOT EXISTS processing_status text,
  ADD COLUMN IF NOT EXISTS processed_at timestamptz,
  ADD COLUMN IF NOT EXISTS processed_hash text,
  ADD COLUMN IF NOT EXISTS processing_error text;

CREATE INDEX IF NOT EXISTS idx_notes_processing_sweep
  ON public.notes (user_id, updated_at)
  WHERE is_trashed = false;
