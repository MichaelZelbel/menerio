
REVOKE EXECUTE ON FUNCTION public.mcp_can_see(uuid,text,uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.mcp_sensitive_person_ids(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.mcp_hidden_counts(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mcp_can_see(uuid,text,uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.mcp_sensitive_person_ids(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.mcp_hidden_counts(uuid) TO authenticated, service_role;
