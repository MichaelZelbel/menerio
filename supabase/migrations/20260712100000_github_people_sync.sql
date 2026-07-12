-- People & Groups GitHub vault sync.
-- Extends github_sync_log so one table tracks notes, contacts, and groups
-- (entity_type + entity_id), and adds a per-connection sync_people toggle.

-- 1. github_sync_log: entity columns ---------------------------------------

ALTER TABLE public.github_sync_log ALTER COLUMN note_id DROP NOT NULL;

ALTER TABLE public.github_sync_log
  ADD COLUMN IF NOT EXISTS entity_type text NOT NULL DEFAULT 'note'
    CONSTRAINT github_sync_log_entity_type_check
    CHECK (entity_type IN ('note', 'person', 'group')),
  ADD COLUMN IF NOT EXISTS entity_id uuid;

UPDATE public.github_sync_log SET entity_id = note_id WHERE entity_id IS NULL;

ALTER TABLE public.github_sync_log ALTER COLUMN entity_id SET NOT NULL;

-- Deliberately NO FK on entity_id: contacts are hard-deleted, and a cascade
-- would erase the github_path needed to delete the mirrored file afterwards.
-- Orphaned rows are retired by the people-sync sweep instead.

CREATE UNIQUE INDEX IF NOT EXISTS idx_sync_log_entity
  ON public.github_sync_log(user_id, entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_sync_log_entity_status
  ON public.github_sync_log(user_id, entity_type, sync_status);

-- 2. github_connections: people-sync toggle --------------------------------

ALTER TABLE public.github_connections
  ADD COLUMN IF NOT EXISTS sync_people boolean NOT NULL DEFAULT true;

-- github_connections uses column-level SELECT grants (20260523110332) so the
-- token never reaches the client. Re-issue the full list including the new
-- column; github_token stays excluded.
REVOKE SELECT ON public.github_connections FROM authenticated;
GRANT SELECT (id, user_id, github_username, repo_owner, repo_name, branch, vault_path,
  sync_enabled, sync_direction, last_sync_at, attachment_folder, sync_people,
  created_at, updated_at)
  ON public.github_connections TO authenticated;
