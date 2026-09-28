-- A1 probes for docs/plans/one-fact-store.md (section 8, "A1 run"). Invented fixture only.
-- Applies the plan's draft DDL (3.2, 3.3) to the local live-schema DB, then reproduces findings 1 and 2.
-- Usage: psql -h /var/tmp/menerio-fact-pg -p 55432 -U postgres -d live -f scripts/rehearsal/a1-probes.sql   (on a fresh build)
\set ON_ERROR_STOP 1
set search_path = public, extensions;
-- 3.2
ALTER TABLE public.claims ADD COLUMN IF NOT EXISTS rank text NOT NULL DEFAULT 'normal' CHECK (rank IN ('preferred','normal'));
ALTER TABLE public.claims DROP CONSTRAINT IF EXISTS claims_source_type_check;
ALTER TABLE public.claims ADD CONSTRAINT claims_source_type_check CHECK (source_type IN ('note','moment','manual','ai','lexicon'));
ALTER TABLE public.claims ADD CONSTRAINT claims_origin_known CHECK (origin IN ('user_manual','unverified','menerio','ai_note','ai_moment','ai_lexicon','review_queue','import','mcp','api','normalizer')) NOT VALID;
CREATE TABLE public.fact_slots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  subject_type text NOT NULL CHECK (subject_type IN ('self','contact','entity')),
  subject_id uuid, attribute text NOT NULL, label text NOT NULL, category_slug text,
  cardinality text CHECK (cardinality IN ('one','many')),
  is_pinned boolean NOT NULL DEFAULT false, show_to_agent boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fact_slots_subject_pair CHECK ((subject_type = 'self' AND subject_id IS NULL) OR (subject_type <> 'self' AND subject_id IS NOT NULL)));
CREATE UNIQUE INDEX fact_slots_one_per_attribute ON public.fact_slots (user_id, subject_type, coalesce(subject_id, '00000000-0000-0000-0000-000000000000'::uuid), attribute);
ALTER TABLE public.fact_slots ENABLE ROW LEVEL SECURITY;
CREATE POLICY own ON public.fact_slots FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
-- fact_today as the plan words it: service role or the row's own user
CREATE FUNCTION public.fact_today(uid uuid) RETURNS date LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS
$$ SELECT CASE WHEN auth.role() = 'service_role' OR auth.uid() = uid THEN public.user_today(uid) END $$;
-- 3.3
CREATE VIEW public.profile_facts WITH (security_invoker = on) AS
SELECT c.id AS claim_id, c.user_id, c.subject_type, c.subject_id,
  CASE WHEN c.subject_type = 'contact' THEN c.subject_id END AS contact_id,
  c.attribute, c.value, c.valid_from, c.valid_to,
  ((c.valid_from IS NULL OR c.valid_from <= public.fact_today(c.user_id)) AND (c.valid_to IS NULL OR c.valid_to > public.fact_today(c.user_id))) AS is_current,
  c.confidence, c.cardinality, c.origin, c.rank, c.evidence_quote, c.source_type, c.source_id, c.review_by, c.created_at, c.updated_at,
  s.id AS slot_id, coalesce(s.label, initcap(replace(c.attribute, '-', ' '))) AS label,
  s.category_slug, cat.name AS category_name, coalesce(cat.visibility_scope, 'all') AS visibility_scope,
  coalesce(s.is_pinned, false) AS is_pinned, coalesce(s.show_to_agent, false) AS show_to_agent,
  (count(*) FILTER (WHERE (c.valid_from IS NULL OR c.valid_from <= public.fact_today(c.user_id)) AND (c.valid_to IS NULL OR c.valid_to > public.fact_today(c.user_id)) AND coalesce(s.cardinality, c.cardinality) = 'one')
     OVER (PARTITION BY c.user_id, c.subject_type, c.subject_id, c.attribute)) > 1 AS has_conflict
FROM public.claims c
LEFT JOIN public.fact_slots s ON s.user_id = c.user_id AND s.subject_type = c.subject_type AND s.subject_id IS NOT DISTINCT FROM c.subject_id AND s.attribute = c.attribute
LEFT JOIN public.profile_categories cat ON c.subject_type <> 'entity' AND cat.user_id = c.user_id AND cat.slug = s.category_slug
 AND cat.contact_id IS NOT DISTINCT FROM (CASE WHEN c.subject_type = 'contact' THEN c.subject_id END);
CREATE VIEW public.agent_facts WITH (security_invoker = on) AS
SELECT f.* FROM public.profile_facts f
WHERE f.visibility_scope <> 'private' AND (f.subject_type = 'self'
  OR (f.subject_type = 'contact' AND EXISTS (SELECT 1 FROM public.contacts ct WHERE ct.id = f.subject_id AND ct.user_id = f.user_id AND ct.merged_into IS NULL AND ct.is_sensitive IS NOT TRUE AND ct.ai_visibility = 'visible'))
  OR (f.subject_type = 'entity' AND EXISTS (SELECT 1 FROM public.entities e WHERE e.id = f.subject_id AND e.user_id = f.user_id AND e.ai_visibility = 'visible' AND e.is_sensitive IS NOT TRUE)));
insert into auth.users(id,email) values ('11111111-1111-1111-1111-111111111111','test@example.invalid');
insert into public.contacts(id,user_id,name) values ('aaaaaaaa-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111','Invented A'),('aaaaaaaa-0000-0000-0000-000000000002','11111111-1111-1111-1111-111111111111','Invented B');
insert into public.claims(user_id,subject_type,subject_id,attribute,value,origin,valid_from,valid_to) values
 ('11111111-1111-1111-1111-111111111111','contact','aaaaaaaa-0000-0000-0000-000000000001','city','Testville','ai_note',null,null),
 ('11111111-1111-1111-1111-111111111111','contact','aaaaaaaa-0000-0000-0000-000000000002','city','Testville','ai_note',null,null),
 ('11111111-1111-1111-1111-111111111111','self',null,'job','Tester','ai_note','2021-01-01',null),
 ('11111111-1111-1111-1111-111111111111','self',null,'city','Oldtown','ai_note','2020-01-01','2024-01-01');
\set ON_ERROR_STOP 0
\echo == Finding 1: as postgres (no JWT), is_current is NULL for dated claims (expected t for Tester, f for Oldtown)
select value, is_current from profile_facts where subject_type='self' order by value;
CREATE UNIQUE INDEX claims_one_live_value ON public.claims (user_id, subject_type, coalesce(subject_id, '00000000-0000-0000-0000-000000000000'::uuid), attribute, md5(lower(btrim(value)))) WHERE valid_to IS NULL;
\echo == Finding 2: contact_merge_move_references violates claims_one_live_value (expect a unique violation)
begin; update contacts set merged_into='aaaaaaaa-0000-0000-0000-000000000002' where id='aaaaaaaa-0000-0000-0000-000000000001'; rollback;
