-- People UX foundations: favorites, view-recency tracking, and group nesting.
-- Additive only. contacts, contact_groups, and profile_entries already carry
-- owner-scoped RLS policies from their original migrations ("Users can
-- manage own contacts" / per-op contact_groups policies / "Users can manage
-- own profile entries"), so no new RLS policies are required here.

-- Favorites + last-viewed recency on contacts.
ALTER TABLE public.contacts
  ADD COLUMN IF NOT EXISTS is_favorite boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS last_viewed_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_contacts_favorite
  ON public.contacts (user_id) WHERE is_favorite = true;

CREATE INDEX IF NOT EXISTS idx_contacts_last_viewed
  ON public.contacts (user_id, last_viewed_at DESC NULLS LAST);

-- Group nesting.
ALTER TABLE public.contact_groups
  ADD COLUMN IF NOT EXISTS parent_group_id uuid REFERENCES public.contact_groups(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_contact_groups_parent
  ON public.contact_groups (parent_group_id);

-- Cycle guard: a group can never become its own ancestor. Walks the
-- ancestor chain from the new parent up to the root; raises if it
-- encounters the row being written (self-parent, or a longer cycle).
CREATE OR REPLACE FUNCTION public.guard_contact_group_parent_cycle()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  current_id uuid;
  depth int := 0;
BEGIN
  IF NEW.parent_group_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.parent_group_id = NEW.id THEN
    RAISE EXCEPTION 'A group cannot be its own parent';
  END IF;

  current_id := NEW.parent_group_id;
  -- Depth cap is a defensive backstop only; the cycle check below always
  -- terminates on well-formed data since this trigger prevents cycles from
  -- ever being written in the first place.
  WHILE current_id IS NOT NULL AND depth < 1000 LOOP
    IF current_id = NEW.id THEN
      RAISE EXCEPTION 'Group hierarchy cannot contain a cycle';
    END IF;
    SELECT parent_group_id INTO current_id FROM public.contact_groups WHERE id = current_id;
    depth := depth + 1;
  END LOOP;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS contact_groups_parent_cycle_guard ON public.contact_groups;
CREATE TRIGGER contact_groups_parent_cycle_guard
BEFORE INSERT OR UPDATE OF parent_group_id ON public.contact_groups
FOR EACH ROW
EXECUTE FUNCTION public.guard_contact_group_parent_cycle();

-- Pinning on profile entries.
ALTER TABLE public.profile_entries
  ADD COLUMN IF NOT EXISTS is_pinned boolean NOT NULL DEFAULT false;
