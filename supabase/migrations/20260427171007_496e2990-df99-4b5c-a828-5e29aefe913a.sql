REVOKE ALL ON FUNCTION public.lookup_mcp_token(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.lookup_mcp_token(text) FROM anon;
REVOKE ALL ON FUNCTION public.lookup_mcp_token(text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.lookup_mcp_token(text) TO service_role;