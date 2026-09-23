-- Merging a contact must bring along everything that points at it.
--
-- WHY: `merge_contacts_atomic` (20260908120002) moves profile entries,
-- relationships, memberships, interactions, action items and note metadata to
-- the surviving contact, then sets `merged_into` on the retired one. It never
-- touched five other references, none of which has a foreign key that would
-- have caught it:
--   moments.person_id, moment_participants.person_id   (the person's timeline)
--   person_documents.person_id                         (memory documents used by chat)
--   collection_items.contact_id                        (collection rows linked to the person)
--   claims (subject_type 'contact', subject_id)        (dated facts, added after the merge function)
-- After merging "Bob" into "Robert", Robert's timeline showed none of Bob's
-- moments, and Bob's facts and documents stayed attached to a contact that no
-- screen shows any more. Nothing was deleted; it simply became unreachable.
--
-- NOW: when `merged_into` is first set to another contact, the same
-- transaction re-points those rows. A merge into the user's own profile
-- (`merged_into` = the contact itself) is left alone: those rows have no
-- contact to move to, and the user profile is not a contact id.

CREATE OR REPLACE FUNCTION public.contact_merge_move_references()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  UPDATE public.moments
     SET person_id = NEW.merged_into
   WHERE user_id = NEW.user_id AND person_id = NEW.id;

  INSERT INTO public.moment_participants (moment_id, person_id)
  SELECT mp.moment_id, NEW.merged_into
    FROM public.moment_participants mp
    JOIN public.moments m ON m.id = mp.moment_id AND m.user_id = NEW.user_id
   WHERE mp.person_id = NEW.id
  ON CONFLICT DO NOTHING;
  DELETE FROM public.moment_participants mp
   USING public.moments m
   WHERE m.id = mp.moment_id AND m.user_id = NEW.user_id AND mp.person_id = NEW.id;

  UPDATE public.person_documents
     SET person_id = NEW.merged_into
   WHERE user_id = NEW.user_id AND person_id = NEW.id;

  UPDATE public.collection_items
     SET contact_id = NEW.merged_into
   WHERE user_id = NEW.user_id AND contact_id = NEW.id;

  UPDATE public.claims
     SET subject_id = NEW.merged_into
   WHERE user_id = NEW.user_id AND subject_type = 'contact' AND subject_id = NEW.id;

  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.contact_merge_move_references() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.contact_merge_move_references() FROM anon;
REVOKE ALL ON FUNCTION public.contact_merge_move_references() FROM authenticated;

DROP TRIGGER IF EXISTS contact_merge_move_references ON public.contacts;
CREATE TRIGGER contact_merge_move_references
  AFTER UPDATE OF merged_into ON public.contacts
  FOR EACH ROW
  WHEN (OLD.merged_into IS NULL AND NEW.merged_into IS NOT NULL AND NEW.merged_into <> NEW.id)
  EXECUTE FUNCTION public.contact_merge_move_references();

-- Contacts merged before this migration: move what is still stranded, once.
-- Follows a chain (A merged into B, B later into C) to the live end.
DO $$
DECLARE
  r record;
  live uuid;
  hops integer;
BEGIN
  FOR r IN SELECT id, user_id, merged_into FROM public.contacts
            WHERE merged_into IS NOT NULL AND merged_into <> id LOOP
    live := r.merged_into;
    FOR hops IN 1..20 LOOP
      EXIT WHEN NOT EXISTS (SELECT 1 FROM public.contacts c WHERE c.id = live AND c.user_id = r.user_id
                              AND c.merged_into IS NOT NULL AND c.merged_into <> c.id);
      SELECT c.merged_into INTO live FROM public.contacts c WHERE c.id = live AND c.user_id = r.user_id;
    END LOOP;
    -- Skip a chain that ends in a self merge or a missing contact.
    CONTINUE WHEN NOT EXISTS (SELECT 1 FROM public.contacts c WHERE c.id = live AND c.user_id = r.user_id AND c.merged_into IS NULL);

    UPDATE public.moments SET person_id = live WHERE user_id = r.user_id AND person_id = r.id;
    INSERT INTO public.moment_participants (moment_id, person_id)
    SELECT mp.moment_id, live FROM public.moment_participants mp
      JOIN public.moments m ON m.id = mp.moment_id AND m.user_id = r.user_id
     WHERE mp.person_id = r.id
    ON CONFLICT DO NOTHING;
    DELETE FROM public.moment_participants mp USING public.moments m
     WHERE m.id = mp.moment_id AND m.user_id = r.user_id AND mp.person_id = r.id;
    UPDATE public.person_documents SET person_id = live WHERE user_id = r.user_id AND person_id = r.id;
    UPDATE public.collection_items SET contact_id = live WHERE user_id = r.user_id AND contact_id = r.id;
    UPDATE public.claims SET subject_id = live
     WHERE user_id = r.user_id AND subject_type = 'contact' AND subject_id = r.id;
  END LOOP;
END $$;
