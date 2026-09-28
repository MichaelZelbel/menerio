-- One fact store, schema half (docs/plans/one-fact-store.md, sections 3.2-3.6, A3, B2).
--
-- Applied in B2, while every fact writer is paused. Adds what claims need to be
-- the only fact store, without moving any data: that is the switch migration
-- (…_fact_store_switch.sql, B5). Rollback: supabase/rollback/20260929090100_fact_store_schema_rollback.sql
-- before the switch ran, supabase/rollback/fact_store_rollback.sql after it.
--
-- Functions this migration replaces are not overwritten. They are moved into
-- schema fact_retired, so the rollback moves them back exactly as they were.
--
-- Every guard below does nothing while `menerio.fact_migration` is 'on'
-- (SET LOCAL by the switch), so the switch can carry legacy rows over as they are.
--
-- No BEGIN/COMMIT in the file: the runner wraps it, so the A6 dress rehearsal
-- can run it inside BEGIN … ROLLBACK.

CREATE SCHEMA IF NOT EXISTS fact_retired;
REVOKE ALL ON SCHEMA fact_retired FROM public, anon, authenticated;

-- 1. claims gains what profile_entries knew and claims did not (3.2).
ALTER TABLE public.claims
  ADD COLUMN IF NOT EXISTS rank text NOT NULL DEFAULT 'normal' CHECK (rank IN ('preferred','normal'));
ALTER TABLE public.claims DROP CONSTRAINT IF EXISTS claims_source_type_check;
ALTER TABLE public.claims ADD CONSTRAINT claims_source_type_check
  CHECK (source_type IN ('note','moment','manual','ai','lexicon'));
-- 0 violations in A1; VALIDATE in B6.
ALTER TABLE public.claims ADD CONSTRAINT claims_origin_known CHECK (origin IN
  ('user_manual','unverified','menerio','ai_note','ai_moment','ai_lexicon',
   'review_queue','import','mcp','api','normalizer')) NOT VALID;

-- 1b. attribute_rules becomes the one registry of "several values" (3.6). It is
-- keyed by the plural ("languages") while canonical labels are singular
-- ("Language"), so the canonical list-valued labels (profile-canonical-schema.ts
-- LIST_VALUED_LABELS, normalized) are added. Existing rows are left as they are.
INSERT INTO public.attribute_rules (attribute, cardinality) VALUES
  ('aliases', 'many'),
  ('allergies', 'many'),
  ('favorite-characters', 'many'),
  ('favorite-desserts', 'many'),
  ('favorite-drinks', 'many'),
  ('favorite-foods', 'many'),
  ('favorite-fruits', 'many'),
  ('favorite-games', 'many'),
  ('favorite-movies', 'many'),
  ('favorite-music-artists', 'many'),
  ('favorite-places', 'many'),
  ('favorite-restaurants', 'many'),
  ('favorite-snacks', 'many'),
  ('favorite-songs', 'many'),
  ('favorite-tv-shows', 'many'),
  ('favorite-youtubers', 'many'),
  ('health-conditions', 'many'),
  ('hobbies', 'many'),
  ('hobby', 'many'),
  ('interest', 'many'),
  ('language', 'many'),
  ('likes', 'many'),
  ('love-language', 'many'),
  ('medications', 'many'),
  ('nickname', 'many'),
  ('personality-traits', 'many'),
  ('pets', 'many'),
  ('skill', 'many'),
  ('tool-/-platform', 'many'),
  ('topic-of-interest', 'many'),
  ('vrchat-activities', 'many'),
  ('vrchat-equipment', 'many'),
  ('vrchat-setup', 'many')
ON CONFLICT (attribute) DO NOTHING;

-- 2. How one attribute of one subject is displayed (3.2).
CREATE TABLE public.fact_slots (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  subject_type  text NOT NULL CHECK (subject_type IN ('self','contact','entity')),
  subject_id    uuid,
  attribute     text NOT NULL,
  label         text NOT NULL,
  category_slug text,
  cardinality   text CHECK (cardinality IN ('one','many')),
  is_pinned     boolean NOT NULL DEFAULT false,
  show_to_agent boolean NOT NULL DEFAULT false,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fact_slots_subject_pair CHECK (
    (subject_type = 'self' AND subject_id IS NULL) OR (subject_type <> 'self' AND subject_id IS NOT NULL))
);
CREATE UNIQUE INDEX fact_slots_one_per_attribute ON public.fact_slots
  (user_id, subject_type, coalesce(subject_id, '00000000-0000-0000-0000-000000000000'::uuid), attribute);
ALTER TABLE public.fact_slots ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view own fact slots" ON public.fact_slots FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own fact slots" ON public.fact_slots FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own fact slots" ON public.fact_slots FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can delete own fact slots" ON public.fact_slots FOR DELETE TO authenticated USING (auth.uid() = user_id);
REVOKE ALL ON public.fact_slots FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.fact_slots TO authenticated, service_role;
CREATE TRIGGER fact_slots_updated_at BEFORE UPDATE ON public.fact_slots
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- 3. The user's today, for the views (3.3). user_today stays revoked from
-- authenticated. Returned to the row's own user and to every caller that is not
-- a browser role: the switch, cron and the management API run as postgres with
-- no JWT, where auth.role() is NULL (A1 run, finding 1).
CREATE FUNCTION public.fact_today(p_user_id uuid) RETURNS date
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT CASE
    WHEN auth.uid() = p_user_id OR coalesce(auth.role(), '') NOT IN ('anon', 'authenticated')
    THEN public.user_today(p_user_id)
  END
$$;
REVOKE ALL ON FUNCTION public.fact_today(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.fact_today(uuid) TO authenticated, service_role;

-- 4. The views (3.3).
CREATE VIEW public.profile_facts WITH (security_invoker = on) AS
SELECT
  c.id AS claim_id,
  c.user_id, c.subject_type, c.subject_id,
  CASE WHEN c.subject_type = 'contact' THEN c.subject_id END AS contact_id,
  c.attribute, c.value, c.valid_from, c.valid_to,
  ((c.valid_from IS NULL OR c.valid_from <= public.fact_today(c.user_id))
   AND (c.valid_to IS NULL OR c.valid_to > public.fact_today(c.user_id))) AS is_current,
  c.confidence, c.cardinality, c.origin, c.rank, c.evidence_quote,
  c.source_type, c.source_id, c.review_by, c.created_at, c.updated_at,
  s.id AS slot_id,
  coalesce(s.label, initcap(replace(c.attribute, '-', ' '))) AS label,
  s.category_slug, cat.name AS category_name,
  coalesce(cat.visibility_scope, 'all') AS visibility_scope,
  coalesce(s.is_pinned, false) AS is_pinned,
  coalesce(s.show_to_agent, false) AS show_to_agent,
  (count(*) FILTER (WHERE (c.valid_from IS NULL OR c.valid_from <= public.fact_today(c.user_id))
                      AND (c.valid_to IS NULL OR c.valid_to > public.fact_today(c.user_id))
                      AND coalesce(s.cardinality, c.cardinality) = 'one')
     OVER (PARTITION BY c.user_id, c.subject_type, c.subject_id, c.attribute)) > 1 AS has_conflict
FROM public.claims c
LEFT JOIN public.fact_slots s
  ON s.user_id = c.user_id AND s.subject_type = c.subject_type
 AND s.subject_id IS NOT DISTINCT FROM c.subject_id AND s.attribute = c.attribute
LEFT JOIN public.profile_categories cat
  ON c.subject_type <> 'entity'
 AND cat.user_id = c.user_id AND cat.slug = s.category_slug
 AND cat.contact_id IS NOT DISTINCT FROM (CASE WHEN c.subject_type = 'contact' THEN c.subject_id END);

CREATE VIEW public.agent_facts WITH (security_invoker = on) AS
SELECT f.* FROM public.profile_facts f
WHERE f.visibility_scope <> 'private'
  AND (
    f.subject_type = 'self'
    OR (f.subject_type = 'contact' AND EXISTS (
          SELECT 1 FROM public.contacts ct
           WHERE ct.id = f.subject_id AND ct.user_id = f.user_id AND ct.merged_into IS NULL
             AND ct.is_sensitive IS NOT TRUE AND ct.ai_visibility = 'visible'))
    OR (f.subject_type = 'entity' AND EXISTS (
          SELECT 1 FROM public.entities e
           WHERE e.id = f.subject_id AND e.user_id = f.user_id
             AND e.ai_visibility = 'visible' AND e.is_sensitive IS NOT TRUE))
  );

REVOKE ALL ON public.profile_facts, public.agent_facts FROM anon;
GRANT SELECT ON public.profile_facts, public.agent_facts TO authenticated, service_role;

-- 5. Guards on claims (3.6). Human = a JWT with a user (auth.uid() IS NOT NULL),
-- exactly as world_preferred_wins decides today. BEFORE triggers fire in name
-- order: preferred_wins first, so a human correction of a legacy row is already
-- 'user_manual' when the origin guard sees it.
CREATE FUNCTION public.claim_preferred_wins() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = 'public' AS $$
DECLARE
  is_human boolean := auth.uid() IS NOT NULL;
BEGIN
  IF current_setting('menerio.fact_migration', true) = 'on' THEN RETURN NEW; END IF;

  IF TG_OP = 'INSERT' THEN
    IF is_human OR NEW.origin = 'user_manual' THEN
      NEW.rank := 'preferred';
    ELSIF NEW.rank = 'preferred' THEN
      -- A job cannot lock its own values (ninth review).
      NEW.rank := 'normal';
    END IF;
    RETURN NEW;
  END IF;

  -- UPDATE
  IF is_human THEN
    IF NEW.value IS DISTINCT FROM OLD.value OR NEW.attribute IS DISTINCT FROM OLD.attribute THEN
      -- The words are now the human's. The old quote stays as provenance.
      NEW.rank := 'preferred';
      NEW.origin := 'user_manual';
    END IF;
    RETURN NEW;
  END IF;

  IF OLD.rank = 'preferred' THEN
    -- A machine may re-file a human's fact (subject_id: a merge), never change
    -- its words or its period. Closing it would be demoting it (Q8).
    NEW.attribute  := OLD.attribute;
    NEW.value      := OLD.value;
    NEW.valid_from := OLD.valid_from;
    NEW.valid_to   := OLD.valid_to;
    NEW.rank       := 'preferred';
  ELSIF NEW.rank = 'preferred' AND NEW.origin IS DISTINCT FROM 'user_manual' THEN
    NEW.rank := OLD.rank;
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION public.claim_preferred_survives_delete() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = 'public' AS $$
BEGIN
  IF current_setting('menerio.fact_migration', true) = 'on' THEN RETURN OLD; END IF;
  IF auth.uid() IS NULL AND OLD.rank = 'preferred' THEN
    -- No JWT at all: the database itself (a cascade from auth.users, a migration).
    IF auth.role() IS NULL THEN RETURN OLD; END IF;
    -- The subject is gone: claims_follow_subject_delete, or a cleanup after it.
    IF OLD.subject_type = 'contact' AND NOT EXISTS (SELECT 1 FROM public.contacts WHERE id = OLD.subject_id) THEN
      RETURN OLD;
    END IF;
    IF OLD.subject_type = 'entity' AND NOT EXISTS (SELECT 1 FROM public.entities WHERE id = OLD.subject_id) THEN
      RETURN OLD;
    END IF;
    -- A machine deleting a human's fact whose subject still exists: cancelled.
    RETURN NULL;
  END IF;
  RETURN OLD;
END;
$$;

-- Raises (never drops silently). Only on INSERT or a value change, so ending
-- or embedding a carried-over legacy row never raises. The message never
-- carries the value.
CREATE FUNCTION public.claim_quality_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = 'public' AS $$
DECLARE
  value_key text := lower(btrim(coalesce(NEW.value, '')));
  attribute_key text := lower(btrim(coalesce(NEW.attribute, '')));
BEGIN
  IF current_setting('menerio.fact_migration', true) = 'on' THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND NEW.value IS NOT DISTINCT FROM OLD.value AND NEW.attribute IS NOT DISTINCT FROM OLD.attribute THEN
    RETURN NEW;
  END IF;
  IF attribute_key = '' OR value_key = '' THEN
    RAISE EXCEPTION 'claim_quality_guard: empty attribute or value' USING ERRCODE = '23514';
  END IF;
  IF value_key IN ('none', 'n/a', 'na', 'unknown', 'unspecified', '-', '—', 'null')
     OR value_key ~ '^(none|n/?a|unknown|unspecified)\s*[.!]?$'
     OR value_key = attribute_key
     OR value_key = replace(attribute_key, '-', ' ') THEN
    RAISE EXCEPTION 'claim_quality_guard: the value is a placeholder or repeats the attribute (%)', NEW.attribute
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

-- Attached by the switch (step 11), after the legacy rows are carried over.
CREATE FUNCTION public.claim_require_origin() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = 'public' AS $$
DECLARE
  allowed text[] := ARRAY['user_manual','unverified','menerio','ai_note','ai_moment','ai_lexicon',
                          'review_queue','import','mcp','api','normalizer'];
BEGIN
  IF current_setting('menerio.fact_migration', true) = 'on' THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND NEW.value IS NOT DISTINCT FROM OLD.value AND NEW.origin IS NOT DISTINCT FROM OLD.origin THEN
    RETURN NEW;
  END IF;
  IF NEW.origin IS NULL OR NOT (NEW.origin = ANY(allowed)) THEN
    RAISE EXCEPTION 'claim_origin_required: unknown origin %', coalesce(NEW.origin, 'NULL') USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'INSERT' AND NEW.origin IN ('unverified', 'menerio') THEN
    RAISE EXCEPTION 'claim_origin_required: % is reserved for legacy rows', NEW.origin USING ERRCODE = '23514';
  END IF;
  IF NEW.origin NOT IN ('user_manual', 'unverified', 'menerio', 'review_queue')
     AND (NEW.evidence_quote IS NULL OR length(btrim(NEW.evidence_quote)) < 10) THEN
    RAISE EXCEPTION 'claim_evidence_required: automated facts need a verbatim source quote' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

-- "Fix a mistake" must not leave search matching the old words (ninth review).
CREATE FUNCTION public.claim_clear_embedding() RETURNS trigger
LANGUAGE plpgsql SET search_path = 'public' AS $$
BEGIN
  IF NEW.value IS DISTINCT FROM OLD.value OR NEW.attribute IS DISTINCT FROM OLD.attribute THEN
    NEW.embedding := NULL;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_claims_a_preferred_wins BEFORE INSERT OR UPDATE ON public.claims
  FOR EACH ROW EXECUTE FUNCTION public.claim_preferred_wins();
CREATE TRIGGER trg_claims_b_quality_guard BEFORE INSERT OR UPDATE ON public.claims
  FOR EACH ROW EXECUTE FUNCTION public.claim_quality_guard();
CREATE TRIGGER trg_claims_d_clear_embedding BEFORE UPDATE OF value, attribute ON public.claims
  FOR EACH ROW EXECUTE FUNCTION public.claim_clear_embedding();
CREATE TRIGGER trg_claims_preferred_delete BEFORE DELETE ON public.claims
  FOR EACH ROW EXECUTE FUNCTION public.claim_preferred_survives_delete();

-- 6. Deleting a person or an entity deletes their facts (3.6). claims.subject_id
-- has no foreign key, so this is explicit. The suppression keys of that subject
-- hold values, so they go too.
CREATE FUNCTION public.claims_follow_subject_delete() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = 'public' AS $$
DECLARE
  kind text := TG_ARGV[0];
BEGIN
  DELETE FROM public.claims WHERE user_id = OLD.user_id AND subject_type = kind AND subject_id = OLD.id;
  DELETE FROM public.fact_slots WHERE user_id = OLD.user_id AND subject_type = kind AND subject_id = OLD.id;
  DELETE FROM public.ai_suggestion_suppressions
   WHERE user_id = OLD.user_id AND suggestion_type = 'claim'
     AND starts_with(suppression_key, kind || ':' || OLD.id::text || ':');
  RETURN NULL;
END;
$$;
CREATE TRIGGER claims_follow_contact_delete AFTER DELETE ON public.contacts
  FOR EACH ROW EXECUTE FUNCTION public.claims_follow_subject_delete('contact');
CREATE TRIGGER claims_follow_entity_delete AFTER DELETE ON public.entities
  FOR EACH ROW EXECUTE FUNCTION public.claims_follow_subject_delete('entity');

-- 7. A private section with facts in it cannot be deleted or renamed (3.6):
-- its facts would fall back to "Other", whose scope is 'all'. A cascade (the
-- contact or the account going away) is let through.
CREATE FUNCTION public.profile_category_keeps_private_facts() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = 'public' AS $$
BEGIN
  IF current_setting('menerio.fact_migration', true) = 'on' OR pg_trigger_depth() > 1 THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.slug IS NOT DISTINCT FROM OLD.slug THEN RETURN NEW; END IF;
  IF OLD.visibility_scope = 'private' AND EXISTS (
       SELECT 1 FROM public.fact_slots s
        WHERE s.user_id = OLD.user_id AND s.category_slug = OLD.slug
          AND s.subject_type = CASE WHEN OLD.contact_id IS NULL THEN 'self' ELSE 'contact' END
          AND s.subject_id IS NOT DISTINCT FROM OLD.contact_id) THEN
    RAISE EXCEPTION 'private_section_not_empty: move or remove its facts first' USING ERRCODE = '23503';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;
CREATE TRIGGER trg_profile_categories_keep_private_facts BEFORE DELETE OR UPDATE OF slug ON public.profile_categories
  FOR EACH ROW EXECUTE FUNCTION public.profile_category_keeps_private_facts();

-- 8. match_claims reads visibility from agent_facts (3.6): private sections and
-- hidden or sensitive entities too, not only contacts. Written from the live text
-- (20260923150000): same signature, same caller check, same grants.
ALTER FUNCTION public.match_claims(extensions.vector, double precision, integer, uuid, date) SET SCHEMA fact_retired;
CREATE FUNCTION public.match_claims(query_embedding extensions.vector, match_threshold double precision DEFAULT 0.2,
  match_count integer DEFAULT 20, p_user_id uuid DEFAULT auth.uid(), p_as_of date DEFAULT NULL::date)
 RETURNS TABLE(id uuid, subject_type text, subject_id uuid, attribute text, value text, valid_from date, valid_to date,
               confidence text, cardinality text, review_by date, evidence_quote text, source_type text, source_id uuid,
               similarity double precision)
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  as_of date;
BEGIN
  IF auth.role() IS NOT NULL AND auth.role() <> 'service_role' AND auth.uid() IS DISTINCT FROM p_user_id THEN
    RAISE EXCEPTION 'not authorized' USING ERRCODE = '42501';
  END IF;

  as_of := COALESCE(p_as_of, public.user_today(p_user_id));

  RETURN QUERY
  SELECT
    c.id, c.subject_type, c.subject_id, c.attribute, c.value,
    c.valid_from, c.valid_to, c.confidence, c.cardinality, c.review_by,
    c.evidence_quote, c.source_type, c.source_id,
    (1 - (c.embedding operator(extensions.<=>) query_embedding))::float AS similarity
  FROM public.claims c
  WHERE c.user_id = p_user_id
    AND c.embedding IS NOT NULL
    AND (c.valid_from IS NULL OR c.valid_from <= as_of)
    AND (c.valid_to   IS NULL OR c.valid_to   >  as_of)
    -- One visibility rule: what assistants may see is agent_facts.
    AND c.id IN (SELECT a.claim_id FROM public.agent_facts a WHERE a.user_id = p_user_id)
    AND (1 - (c.embedding operator(extensions.<=>) query_embedding)) > match_threshold
  ORDER BY c.embedding operator(extensions.<=>) query_embedding
  LIMIT match_count;
END;
$function$;
REVOKE ALL ON FUNCTION public.match_claims(extensions.vector, double precision, integer, uuid, date) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.match_claims(extensions.vector, double precision, integer, uuid, date) TO authenticated, service_role;

