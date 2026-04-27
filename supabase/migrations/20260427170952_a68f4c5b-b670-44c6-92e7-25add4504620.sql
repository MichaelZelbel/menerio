CREATE TABLE public.mcp_api_tokens (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL DEFAULT auth.uid(),
  name text NOT NULL,
  token_hash text NOT NULL,
  token_prefix text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz NULL,
  expires_at timestamptz NULL,
  revoked_at timestamptz NULL,
  CONSTRAINT mcp_api_tokens_name_length CHECK (char_length(name) <= 80),
  CONSTRAINT mcp_api_tokens_token_hash_unique UNIQUE (token_hash)
);

CREATE INDEX idx_mcp_api_tokens_user_id ON public.mcp_api_tokens(user_id);

ALTER TABLE public.mcp_api_tokens ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own MCP tokens"
ON public.mcp_api_tokens
FOR SELECT
TO authenticated
USING (auth.uid() = user_id);

CREATE POLICY "Users can create own MCP tokens"
ON public.mcp_api_tokens
FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own MCP tokens"
ON public.mcp_api_tokens
FOR UPDATE
TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own MCP tokens"
ON public.mcp_api_tokens
FOR DELETE
TO authenticated
USING (auth.uid() = user_id);

CREATE OR REPLACE FUNCTION public.lookup_mcp_token(_token_hash text)
RETURNS TABLE (
  id uuid,
  user_id uuid,
  expires_at timestamptz,
  revoked_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.mcp_api_tokens
     SET last_used_at = now()
   WHERE token_hash = _token_hash
     AND revoked_at IS NULL
     AND (expires_at IS NULL OR expires_at > now());

  RETURN QUERY
  SELECT t.id, t.user_id, t.expires_at, t.revoked_at
    FROM public.mcp_api_tokens t
   WHERE t.token_hash = _token_hash
     AND t.revoked_at IS NULL
     AND (t.expires_at IS NULL OR t.expires_at > now());
END;
$$;