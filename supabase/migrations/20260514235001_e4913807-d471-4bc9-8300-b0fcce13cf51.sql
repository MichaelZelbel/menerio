-- 1) Remove redundant plaintext api_key on connected_apps (key_hash + key_prefix already store what we need)
ALTER TABLE public.connected_apps DROP COLUMN IF EXISTS api_key;

-- 2) Revoke client SELECT on integration secrets so they are never returned to the browser.
--    Edge functions use the service_role and bypass column privileges.
REVOKE SELECT (bot_token) ON public.discord_connections FROM authenticated, anon;
REVOKE SELECT (bot_token) ON public.telegram_connections FROM authenticated, anon;
REVOKE SELECT (webhook_secret) ON public.telegram_connections FROM authenticated, anon;
REVOKE SELECT (github_token) ON public.github_connections FROM authenticated, anon;

-- Keep INSERT/UPDATE on these columns so users can still set/rotate via RLS-checked writes.
GRANT INSERT (bot_token), UPDATE (bot_token) ON public.discord_connections TO authenticated;
GRANT INSERT (bot_token, webhook_secret), UPDATE (bot_token, webhook_secret) ON public.telegram_connections TO authenticated;
GRANT INSERT (github_token), UPDATE (github_token) ON public.github_connections TO authenticated;

-- 3) Allow users to read their own moderation review queue entries (was admin-only SELECT).
CREATE POLICY "Users can view own review queue items"
  ON public.moderation_review_queue
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());