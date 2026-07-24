REVOKE ALL ON FUNCTION public.enqueue_profile_normalization_job(uuid, uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.profile_entry_norm_text(text) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.enqueue_profile_normalization_job(uuid, uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.profile_entry_norm_text(text) TO service_role;