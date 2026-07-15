-- Per-user outbound MCP servers that the in-app chat agents (note-chat,
-- conversation-chat/Mira) may call as tools. This is the OUTBOUND counterpart
-- to mcp_api_tokens (which is inbound: letting external clients into Menerio's
-- own MCP server). Here the user registers third-party MCP servers Menerio
-- should connect out to.
--
-- Security note: unlike mcp_api_tokens (which stores a hash), an outbound
-- server needs the real credential to authenticate, so `auth` holds a secret.
-- The row is RLS-locked to the owner and the secret is only ever read
-- server-side (service role) at call time. A future hardening step can move the
-- secret into Supabase Vault; for now RLS + service-role-only reads are the
-- boundary.

CREATE TABLE public.user_mcp_servers (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL DEFAULT auth.uid(),
  name text NOT NULL,
  url text NOT NULL,
  -- e.g. { "token": "..." } or { "headers": { "X-Api-Key": "..." } }
  auth jsonb NOT NULL DEFAULT '{}'::jsonb,
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT user_mcp_servers_name_length CHECK (char_length(name) <= 80),
  CONSTRAINT user_mcp_servers_url_scheme CHECK (url ~* '^https://')
);

CREATE INDEX idx_user_mcp_servers_user_id ON public.user_mcp_servers(user_id);

ALTER TABLE public.user_mcp_servers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own MCP servers"
ON public.user_mcp_servers
FOR SELECT
TO authenticated
USING (auth.uid() = user_id);

CREATE POLICY "Users can create own MCP servers"
ON public.user_mcp_servers
FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own MCP servers"
ON public.user_mcp_servers
FOR UPDATE
TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own MCP servers"
ON public.user_mcp_servers
FOR DELETE
TO authenticated
USING (auth.uid() = user_id);
