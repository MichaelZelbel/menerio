-- WORLD -----------------------------------------------------------------------
-- World is a view over rows that already exist. It is not a new store and it has
-- no extractor of its own. The `entities` and `claims` tables added on
-- 2026-08-11 stay where they are (1 test row and 0 rows on 2026-08-16); the real
-- world is in `contacts`, `moments`, `profile_entries` and
-- `contact_relationships`, and that is what these views read.
--
-- Building World as a second store would have made a second copy of all 226
-- contacts, and every name would exist twice.

-- 1. RANK ---------------------------------------------------------------------
-- Several values of the same attribute can be true at once. Michael has more
-- than one current email address, so "mark the stale one" is the wrong job.
-- The job is: when a machine has to pick one value for a form, which one does it
-- pick. That is what `preferred` answers, and nothing else depends on it.

ALTER TABLE public.profile_entries
  ADD COLUMN IF NOT EXISTS rank text NOT NULL DEFAULT 'normal';

ALTER TABLE public.contact_relationships
  ADD COLUMN IF NOT EXISTS rank text NOT NULL DEFAULT 'normal';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'profile_entries_rank_check') THEN
    ALTER TABLE public.profile_entries
      ADD CONSTRAINT profile_entries_rank_check CHECK (rank IN ('preferred', 'normal'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'contact_relationships_rank_check') THEN
    ALTER TABLE public.contact_relationships
      ADD CONSTRAINT contact_relationships_rank_check CHECK (rank IN ('preferred', 'normal'));
  END IF;
END $$;

-- Everything a human already typed by hand is preferred from today.
UPDATE public.profile_entries SET rank = 'preferred'
  WHERE origin = 'user_manual' AND rank <> 'preferred';
UPDATE public.contact_relationships SET rank = 'preferred'
  WHERE origin = 'user_manual' AND rank <> 'preferred';

-- 2. HAND EDITS WIN -----------------------------------------------------------
-- This rule is enforced here, in the database, and not in the application,
-- because 19 different files write to `profile_entries`. A rule added in 19
-- places is a rule that will be missed in the twentieth.
--
-- Postgres can already tell a human from a machine and does not need to be told:
-- the app writes as the logged-in user, so `auth.uid()` is set. Every background
-- job, every edge function and the MCP server write with the service role, where
-- `auth.uid()` is null. An AI acting for Michael is a machine here, which is the
-- answer we want.
--
-- A machine is not blocked and no exception is raised, because a batch job that
-- touches one hand-edited row among a hundred must not die. It may still re-file
-- a preferred row: change its category, its link to a person, its sort order.
-- It may not change the words, and it may not demote it. Its disagreeing version
-- arrives the way it already does, as a second row.

CREATE OR REPLACE FUNCTION public.world_preferred_wins()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  is_human boolean := auth.uid() IS NOT NULL;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF is_human OR NEW.origin = 'user_manual' THEN
      NEW.rank := 'preferred';
    END IF;
    RETURN NEW;
  END IF;

  -- UPDATE
  IF is_human THEN
    NEW.rank := 'preferred';
    RETURN NEW;
  END IF;

  IF OLD.rank = 'preferred' THEN
    -- Put the human's words back. Everything else in the row may change.
    IF TG_TABLE_NAME = 'profile_entries' THEN
      NEW.label := OLD.label;
      NEW.value := OLD.value;
    ELSE
      NEW.label := OLD.label;
      NEW.custom_label := OLD.custom_label;
    END IF;
    NEW.rank := 'preferred';
  END IF;

  RETURN NEW;
END;
$$;

-- A machine deleting a hand-edited row is cancelled outright. Losing the row is
-- worse than losing the tidy-up that wanted it gone.
CREATE OR REPLACE FUNCTION public.world_preferred_survives_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL AND OLD.rank = 'preferred' THEN
    RETURN NULL;
  END IF;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_profile_entries_preferred_wins ON public.profile_entries;
CREATE TRIGGER trg_profile_entries_preferred_wins
  BEFORE INSERT OR UPDATE ON public.profile_entries
  FOR EACH ROW EXECUTE FUNCTION public.world_preferred_wins();

DROP TRIGGER IF EXISTS trg_profile_entries_preferred_delete ON public.profile_entries;
CREATE TRIGGER trg_profile_entries_preferred_delete
  BEFORE DELETE ON public.profile_entries
  FOR EACH ROW EXECUTE FUNCTION public.world_preferred_survives_delete();

DROP TRIGGER IF EXISTS trg_contact_relationships_preferred_wins ON public.contact_relationships;
CREATE TRIGGER trg_contact_relationships_preferred_wins
  BEFORE INSERT OR UPDATE ON public.contact_relationships
  FOR EACH ROW EXECUTE FUNCTION public.world_preferred_wins();

DROP TRIGGER IF EXISTS trg_contact_relationships_preferred_delete ON public.contact_relationships;
CREATE TRIGGER trg_contact_relationships_preferred_delete
  BEFORE DELETE ON public.contact_relationships
  FOR EACH ROW EXECUTE FUNCTION public.world_preferred_survives_delete();

-- 3. THE THREE VIEWS ----------------------------------------------------------
-- security_invoker so the existing row level security on the underlying tables
-- decides what a reader sees. The views add no new access.

DROP VIEW IF EXISTS public.world_entities;
CREATE VIEW public.world_entities WITH (security_invoker = on) AS
  SELECT
    c.id,
    c.user_id,
    'contact'::text AS source_table,
    COALESCE(NULLIF(btrim(c.entity_kind), ''), 'person') AS kind,
    c.name,
    COALESCE(c.aliases, '{}'::text[]) AS aliases,
    c.notes AS description,
    c.ai_visibility,
    c.is_sensitive,
    COALESCE(c.created_at, now()) AS created_at,
    COALESCE(c.updated_at, c.created_at, now()) AS updated_at
  FROM public.contacts c
  WHERE c.merged_into IS NULL
  UNION ALL
  SELECT
    e.id,
    e.user_id,
    'entity'::text AS source_table,
    e.entity_type AS kind,
    e.name,
    COALESCE(e.aliases, '{}'::text[]) AS aliases,
    e.description,
    e.ai_visibility,
    e.is_sensitive,
    e.created_at,
    e.updated_at
  FROM public.entities e;

DROP VIEW IF EXISTS public.world_events;
CREATE VIEW public.world_events WITH (security_invoker = on) AS
  SELECT
    m.id,
    m.user_id,
    'moment'::text AS source_table,
    m.title,
    m.description,
    m.happened_at,
    m.happened_end,
    m.person_id,
    m.category,
    m.status,
    m.ai_visibility,
    m.created_at,
    m.updated_at
  FROM public.moments m
  WHERE m.deleted_at IS NULL;

-- A claim is one believed fact about one subject. Profile facts and
-- relationships are both exactly that, which is why they are one list and not
-- two. `object_id` is set only for a relationship, because only a relationship
-- points at a second thing.
DROP VIEW IF EXISTS public.world_claims;
CREATE VIEW public.world_claims WITH (security_invoker = on) AS
  SELECT
    p.id,
    p.user_id,
    'profile_entry'::text AS source_table,
    CASE WHEN p.contact_id IS NULL THEN 'self' ELSE 'contact' END AS subject_kind,
    p.contact_id AS subject_id,
    cat.slug AS category,
    p.label AS attribute,
    p.value,
    NULL::uuid AS object_id,
    NULL::date AS valid_from,
    NULL::date AS valid_to,
    p.origin,
    p.rank,
    p.evidence_quote,
    p.created_at,
    p.updated_at
  FROM public.profile_entries p
  LEFT JOIN public.profile_categories cat ON cat.id = p.category_id
  UNION ALL
  SELECT
    r.id,
    r.user_id,
    'contact_relationship'::text AS source_table,
    r.source_type AS subject_kind,
    r.source_id AS subject_id,
    'relationship'::text AS category,
    'relationship'::text AS attribute,
    COALESCE(NULLIF(btrim(r.custom_label), ''), r.label) AS value,
    r.target_id AS object_id,
    r.valid_from,
    r.valid_to,
    r.origin,
    r.rank,
    r.evidence_quote,
    r.created_at,
    r.updated_at
  FROM public.contact_relationships r;

GRANT SELECT ON public.world_entities TO authenticated, service_role;
GRANT SELECT ON public.world_events TO authenticated, service_role;
GRANT SELECT ON public.world_claims TO authenticated, service_role;