-- world_preferred_survives_delete() is the BEFORE DELETE guard on
-- contact_relationships (and, disabled, on profile_entries_archive). Since
-- 20260916120000 it read a field of the other table in the same IF as the
-- table test:
--
--   IF TG_TABLE_NAME = 'profile_entries' AND OLD.contact_id IS NOT NULL ...
--
-- PL/pgSQL resolves OLD.<field> against the row actually being deleted before
-- it evaluates the expression, so the table test never protects the field
-- read. Every service-role delete of a hand-edited ('preferred') relationship
-- therefore raised `record "old" has no field "contact_id"` (SQLSTATE 42703)
-- instead of being refused quietly. Production logs show it on
-- DELETE /rest/v1/contact_relationships from profile-reconcile (2026-09-27
-- 22:17 and 2026-09-28 00:17 UTC). The raise aborts the whole statement, so
-- profile-reconcile's batched drop of up to 100 invalid or duplicate rows
-- deleted none of them when one was hand-edited, and review-queue-bulk and
-- profile-lint fail outright on the same delete. Reproduced on production's
-- engine in a read-only DO block: the flat form raises, the nested form does
-- not.
--
-- Second defect in the same branch: a 'self' endpoint has no id, and
-- NOT EXISTS (... WHERE id = NULL) is true, so once the raise was gone the
-- guard would have let a machine delete every hand-edited "me -> person"
-- relationship, which are the only hand-edited relationships production has.
-- A 'self' endpoint is the account itself, which still exists while its rows
-- do (an account deletion runs with no JWT and is let through above).
--
-- Behaviour, unchanged otherwise:
--   a person (a JWT with a uid) deletes anything; a session with no JWT (the
--   database itself: cascades from auth.users, migrations) deletes anything;
--   a service-role delete of a preferred row goes through only when a
--   contact it points at is already gone (a cascade), and is otherwise
--   cancelled for that row alone (RETURN NULL), the other rows of the same
--   statement still being deleted.
--
-- Idempotent: CREATE OR REPLACE of one function; the triggers are unchanged.

CREATE OR REPLACE FUNCTION public.world_preferred_survives_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL AND OLD.rank = 'preferred' THEN
    -- No JWT at all: the database itself (a cascade from auth.users or from
    -- contacts, a migration). Never veto that.
    IF auth.role() IS NULL THEN
      RETURN OLD;
    END IF;
    -- A service-role session whose parent contact is already gone is a cascade
    -- too; keeping the row would leave it pointing at nothing. Each table's
    -- fields are read only inside its own branch (see the header).
    IF TG_TABLE_NAME = 'profile_entries' THEN
      IF OLD.contact_id IS NOT NULL
         AND NOT EXISTS (SELECT 1 FROM public.contacts WHERE id = OLD.contact_id) THEN
        RETURN OLD;
      END IF;
    ELSIF TG_TABLE_NAME = 'contact_relationships' THEN
      IF (OLD.source_id IS NOT NULL
            AND NOT EXISTS (SELECT 1 FROM public.contacts WHERE id = OLD.source_id))
         OR (OLD.target_id IS NOT NULL
            AND NOT EXISTS (SELECT 1 FROM public.contacts WHERE id = OLD.target_id)) THEN
        RETURN OLD;
      END IF;
    END IF;
    -- A machine deleting a hand-edited row whose parent still exists is
    -- cancelled outright, as before.
    RETURN NULL;
  END IF;
  RETURN OLD;
END;
$$;
