-- A profile entry and the claim it displays are one fact. Keep them one.
--
-- Since migration 20260901093000 a profile entry is the row the profile page
-- shows and its claim (derived_from_claim_id) is the dated record underneath.
-- Nothing kept the two together after the link was made:
--   * editing an entry's value left the claim saying the old thing, and
--     get_contact_profile tells agents to prefer the claim;
--   * deleting an entry (by hand, by the nightly bag split, by a duplicate
--     fold) left its claim live, so the profile's second "Facts" card went on
--     showing a fact the grouped list no longer had.
-- The page now shows one list, and promote-profile-entries gives every live
-- claim a row in it. Without these triggers that job would bring a deleted
-- fact straight back.

-- An edit to what an entry says is an edit to its claim.
CREATE OR REPLACE FUNCTION public.profile_entry_sync_claim()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.derived_from_claim_id IS NULL THEN
    RETURN NEW;
  END IF;
  IF NEW.value IS NOT DISTINCT FROM OLD.value AND NEW.label IS NOT DISTINCT FROM OLD.label THEN
    RETURN NEW;
  END IF;
  UPDATE public.claims
     SET value = NEW.value,
         attribute = lower(regexp_replace(trim(NEW.label), '\s+', '-', 'g')),
         -- The old vector describes the old words; backfill-claim-embeddings
         -- re-embeds every claim whose embedding is missing.
         embedding = CASE WHEN value IS DISTINCT FROM NEW.value THEN NULL ELSE embedding END
   WHERE id = NEW.derived_from_claim_id
     AND user_id = NEW.user_id
     AND valid_to IS NULL;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_profile_entry_sync_claim ON public.profile_entries;
CREATE TRIGGER trg_profile_entry_sync_claim
AFTER UPDATE OF value, label ON public.profile_entries
FOR EACH ROW EXECUTE FUNCTION public.profile_entry_sync_claim();

-- Removing the last row that shows a claim ends the claim. Ended, not
-- deleted: a background job that split or folded the row must not erase the
-- dated record. When the user deletes a fact on purpose the page deletes the
-- claim itself first, and then this finds nothing to do.
CREATE OR REPLACE FUNCTION public.profile_entry_end_claim()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF OLD.derived_from_claim_id IS NULL THEN
    RETURN OLD;
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.profile_entries
     WHERE derived_from_claim_id = OLD.derived_from_claim_id AND id <> OLD.id
  ) THEN
    RETURN OLD;
  END IF;
  UPDATE public.claims
     SET valid_to = greatest(current_date, valid_from)
   WHERE id = OLD.derived_from_claim_id
     AND user_id = OLD.user_id
     AND valid_to IS NULL;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_profile_entry_end_claim ON public.profile_entries;
CREATE TRIGGER trg_profile_entry_end_claim
AFTER DELETE ON public.profile_entries
FOR EACH ROW EXECUTE FUNCTION public.profile_entry_end_claim();

REVOKE ALL ON FUNCTION public.profile_entry_sync_claim() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.profile_entry_end_claim() FROM PUBLIC, anon, authenticated;
