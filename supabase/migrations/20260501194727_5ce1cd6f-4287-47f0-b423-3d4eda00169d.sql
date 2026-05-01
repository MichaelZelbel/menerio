-- 1. note_attachments table
CREATE TABLE public.note_attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  filename text NOT NULL,
  storage_path text NOT NULL,
  size_bytes integer,
  mime_type text,
  sha256 text,
  github_path text,
  github_sha text,
  github_synced_at timestamptz,
  source text NOT NULL DEFAULT 'menerio',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT note_attachments_user_filename_unique UNIQUE (user_id, filename)
);

CREATE INDEX idx_note_attachments_user_filename
  ON public.note_attachments (user_id, filename);

CREATE INDEX idx_note_attachments_user_sha256
  ON public.note_attachments (user_id, sha256);

ALTER TABLE public.note_attachments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view own attachments"
  ON public.note_attachments FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users insert own attachments"
  ON public.note_attachments FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users update own attachments"
  ON public.note_attachments FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users delete own attachments"
  ON public.note_attachments FOR DELETE
  USING (auth.uid() = user_id);

CREATE TRIGGER trg_note_attachments_updated_at
  BEFORE UPDATE ON public.note_attachments
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_updated_at();

-- 2. attachment_folder on github_connections
ALTER TABLE public.github_connections
  ADD COLUMN IF NOT EXISTS attachment_folder text NOT NULL DEFAULT 'attachments';