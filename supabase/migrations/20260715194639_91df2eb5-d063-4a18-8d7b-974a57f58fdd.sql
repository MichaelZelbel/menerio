CREATE TABLE public.user_mcp_servers (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL DEFAULT auth.uid(),
  name text NOT NULL,
  url text NOT NULL,
  auth jsonb NOT NULL DEFAULT '{}'::jsonb,
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT user_mcp_servers_name_length CHECK (char_length(name) <= 80),
  CONSTRAINT user_mcp_servers_url_scheme CHECK (url ~* '^https://')
);

CREATE INDEX idx_user_mcp_servers_user_id ON public.user_mcp_servers(user_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_mcp_servers TO authenticated;
GRANT ALL ON public.user_mcp_servers TO service_role;

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

CREATE TRIGGER user_mcp_servers_set_updated_at
BEFORE UPDATE ON public.user_mcp_servers
FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();