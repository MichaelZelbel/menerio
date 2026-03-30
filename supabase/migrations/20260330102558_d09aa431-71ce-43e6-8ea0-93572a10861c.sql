
-- GitHub connections table
CREATE TABLE public.github_connections (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE UNIQUE,
  github_token text NOT NULL,
  github_username text,
  repo_owner text,
  repo_name text,
  branch text DEFAULT 'main',
  vault_path text DEFAULT '/',
  sync_enabled boolean DEFAULT true,
  sync_direction text DEFAULT 'export',
  last_sync_at timestamptz,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE public.github_connections ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own github connection"
  ON public.github_connections FOR ALL
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- GitHub sync log table
CREATE TABLE public.github_sync_log (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  note_id uuid NOT NULL REFERENCES public.notes(id) ON DELETE CASCADE,
  github_path text NOT NULL,
  github_sha text,
  last_commit_sha text,
  sync_status text DEFAULT 'synced',
  sync_direction text,
  error_message text,
  synced_at timestamptz DEFAULT now()
);

CREATE UNIQUE INDEX idx_sync_log_note ON public.github_sync_log(user_id, note_id);
CREATE INDEX idx_sync_log_status ON public.github_sync_log(user_id, sync_status);

ALTER TABLE public.github_sync_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own sync log"
  ON public.github_sync_log FOR ALL
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());
