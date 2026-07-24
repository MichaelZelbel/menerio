DROP TRIGGER IF EXISTS trg_profile_entries_prevent_duplicate_fact ON public.profile_entries;

CREATE TRIGGER trg_profile_entries_prevent_duplicate_fact
BEFORE INSERT OR UPDATE OF user_id, contact_id, label, value
ON public.profile_entries
FOR EACH ROW
EXECUTE FUNCTION public.profile_entries_prevent_duplicate_fact();