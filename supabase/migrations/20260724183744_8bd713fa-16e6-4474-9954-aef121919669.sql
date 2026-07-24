REVOKE ALL ON FUNCTION public.profile_entries_prevent_duplicate_fact() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.profile_existing_token_keys(uuid, uuid, text, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.cleanup_profile_token_duplicates() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cleanup_profile_token_duplicates() TO service_role;