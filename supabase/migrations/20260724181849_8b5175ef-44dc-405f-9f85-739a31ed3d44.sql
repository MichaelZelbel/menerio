CREATE UNIQUE INDEX IF NOT EXISTS profile_entries_unique_profile_fact
ON public.profile_entries (
  user_id,
  COALESCE(contact_id, '00000000-0000-0000-0000-000000000000'::uuid),
  public.profile_fact_label_key(label),
  public.profile_fact_text_key(value)
)
WHERE public.profile_fact_label_key(label) <> ''
  AND public.profile_fact_text_key(value) <> '';

REVOKE EXECUTE ON FUNCTION public.profile_entries_prevent_duplicate_fact() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.profile_fact_text_key(text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.profile_fact_label_key(text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.profile_value_contains_fact(text, text) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.profile_entries_prevent_duplicate_fact() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.profile_fact_text_key(text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.profile_fact_label_key(text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.profile_value_contains_fact(text, text) TO authenticated, service_role;