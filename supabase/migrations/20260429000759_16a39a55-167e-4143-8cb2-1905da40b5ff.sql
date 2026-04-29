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
  RETURN QUERY
  UPDATE public.mcp_api_tokens t
     SET last_used_at = now()
   WHERE t.token_hash = _token_hash
     AND t.revoked_at IS NULL
     AND (t.expires_at IS NULL OR t.expires_at > now())
   RETURNING t.id, t.user_id, t.expires_at, t.revoked_at;
END;
$$;

REVOKE ALL ON FUNCTION public.lookup_mcp_token(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.lookup_mcp_token(text) FROM anon;
REVOKE ALL ON FUNCTION public.lookup_mcp_token(text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.lookup_mcp_token(text) TO service_role;