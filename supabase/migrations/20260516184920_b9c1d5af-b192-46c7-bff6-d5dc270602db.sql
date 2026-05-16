
-- Lock down sensitive secret columns by revoking table-level SELECT and re-granting only safe columns
-- Discord
REVOKE SELECT ON TABLE public.discord_connections FROM authenticated, anon;
GRANT SELECT (id, user_id, discord_guild_id, discord_channel_id, application_id, public_key, is_active, created_at, updated_at) ON public.discord_connections TO authenticated;

-- Telegram
REVOKE SELECT ON TABLE public.telegram_connections FROM authenticated, anon;
GRANT SELECT (id, user_id, telegram_chat_id, pairing_code, is_active, is_paired, created_at, updated_at) ON public.telegram_connections TO authenticated;

-- GitHub
REVOKE SELECT ON TABLE public.github_connections FROM authenticated, anon;
GRANT SELECT (id, user_id, github_username, repo_owner, repo_name, branch, vault_path, sync_enabled, sync_direction, last_sync_at, attachment_folder, created_at, updated_at) ON public.github_connections TO authenticated;

-- Moderation events: allow users to view their own events
DROP POLICY IF EXISTS "Users can view own moderation events" ON public.moderation_events;
CREATE POLICY "Users can view own moderation events"
  ON public.moderation_events FOR SELECT TO authenticated
  USING (user_id = auth.uid());

-- Activity events: block client updates and deletes (system-managed only)
DROP POLICY IF EXISTS "Block client updates on activity_events" ON public.activity_events;
CREATE POLICY "Block client updates on activity_events"
  ON public.activity_events FOR UPDATE TO authenticated
  USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS "Block client deletes on activity_events" ON public.activity_events;
CREATE POLICY "Block client deletes on activity_events"
  ON public.activity_events FOR DELETE TO authenticated
  USING (false);
