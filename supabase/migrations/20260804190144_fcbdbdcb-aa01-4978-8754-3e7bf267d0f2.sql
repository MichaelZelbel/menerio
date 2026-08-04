
CREATE TABLE public.gdrive_connections (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL UNIQUE,
  connection_key TEXT,
  google_email TEXT,
  watch_folder_id TEXT,
  watch_folder_name TEXT,
  target_note_folder TEXT NOT NULL DEFAULT 'auto-import',
  sync_enabled BOOLEAN NOT NULL DEFAULT true,
  last_sync_at TIMESTAMPTZ,
  last_error TEXT,
  channel_id TEXT,
  channel_token TEXT,
  channel_expires_at TIMESTAMPTZ,
  start_page_token TEXT,
  last_webhook_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.gdrive_connections TO authenticated;
GRANT ALL ON public.gdrive_connections TO service_role;

ALTER TABLE public.gdrive_connections ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage their own gdrive connection"
ON public.gdrive_connections FOR ALL TO authenticated
USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE TRIGGER gdrive_connections_updated_at
BEFORE UPDATE ON public.gdrive_connections
FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

CREATE TABLE public.gdrive_imports (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  file_id TEXT NOT NULL,
  file_name TEXT,
  mime_type TEXT,
  note_id UUID REFERENCES public.notes(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'imported',
  error TEXT,
  imported_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, file_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.gdrive_imports TO authenticated;
GRANT ALL ON public.gdrive_imports TO service_role;

ALTER TABLE public.gdrive_imports ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage their own gdrive imports"
ON public.gdrive_imports FOR ALL TO authenticated
USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE TRIGGER gdrive_imports_updated_at
BEFORE UPDATE ON public.gdrive_imports
FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

CREATE INDEX idx_gdrive_imports_user_time ON public.gdrive_imports (user_id, imported_at DESC);
