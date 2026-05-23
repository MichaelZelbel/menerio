
-- Hide secret columns from client by revoking SELECT and re-granting on non-secret columns only.

-- discord_connections
REVOKE SELECT ON public.discord_connections FROM authenticated;
GRANT SELECT (id, user_id, discord_guild_id, discord_channel_id, application_id, public_key, is_active, created_at, updated_at)
  ON public.discord_connections TO authenticated;

-- github_connections
REVOKE SELECT ON public.github_connections FROM authenticated;
GRANT SELECT (id, user_id, github_username, repo_owner, repo_name, branch, vault_path, sync_enabled, sync_direction, last_sync_at, attachment_folder, created_at, updated_at)
  ON public.github_connections TO authenticated;

-- telegram_connections
REVOKE SELECT ON public.telegram_connections FROM authenticated;
GRANT SELECT (id, user_id, telegram_chat_id, pairing_code, is_active, is_paired, created_at, updated_at)
  ON public.telegram_connections TO authenticated;

-- Harden user_roles: explicit restrictive policies blocking non-admin writes.
CREATE POLICY "Only admins can insert roles"
  ON public.user_roles FOR INSERT TO authenticated
  WITH CHECK (public.is_admin(auth.uid()));

CREATE POLICY "Only admins can update roles"
  ON public.user_roles FOR UPDATE TO authenticated
  USING (public.is_admin(auth.uid()))
  WITH CHECK (public.is_admin(auth.uid()));

CREATE POLICY "Only admins can delete roles"
  ON public.user_roles FOR DELETE TO authenticated
  USING (public.is_admin(auth.uid()));
