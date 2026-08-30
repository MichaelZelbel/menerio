-- The keystone. public.claims has existed since 2026-08-11 with dates,
-- confidence and a source link, and appears in NO view. `FROM public.claims`
-- occurs in no migration before this one.
--
-- world_claims, the endpoint the hub mirrors, is a union of profile_entries
-- (with valid_from and valid_to hardcoded NULL, because that table has no date
-- columns at all) and contact_relationships. That is why 198 of the hub's 200
-- mirrored claims were named "undated": not because nobody filled the dates in,
-- but because the view could not carry one.
--
-- This widens the view to three arms. The first two are copied verbatim from
-- 20260816120000_9a3f61c2-4d70-4c88-9b21-7e0a5c1d3f84.sql lines 191-229. This
-- is a widening, not a rewrite: improving them while moving them is how a
-- migration quietly changes data nobody asked it to touch.
--
-- Two columns are added to every arm so the shape stays uniform:
--   cardinality  one | many
--   review_by    when to doubt this fact (NULL where the arm cannot know)
-- and source_kind / source_ref carry the note a fact came from.

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
    'likely'::text AS confidence,
    -- A profile entry carries no dates and no cardinality of its own. It is a
    -- display row; the fact behind it belongs in claims.
    COALESCE(ar.cardinality, 'one'::text) AS cardinality,
    NULL::date AS review_by,
    CASE WHEN p.linked_note_id IS NULL THEN NULL ELSE 'note'::text END AS source_kind,
    p.linked_note_id AS source_ref,
    p.origin,
    p.rank,
    p.evidence_quote,
    p.created_at,
    p.updated_at
  FROM public.profile_entries p
  LEFT JOIN public.profile_categories cat ON cat.id = p.category_id
  LEFT JOIN public.attribute_rules ar
    ON ar.attribute = lower(regexp_replace(btrim(p.label), '\s+', '-', 'g'))

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
    'likely'::text AS confidence,
    -- A person has several live relationships at once, always. Treating this
    -- arm as single-valued would report every friendship as a contradiction.
    'many'::text AS cardinality,
    NULL::date AS review_by,
    NULL::text AS source_kind,
    NULL::uuid AS source_ref,
    r.origin,
    r.rank,
    r.evidence_quote,
    r.created_at,
    r.updated_at
  FROM public.contact_relationships r

  UNION ALL

  SELECT
    c.id,
    c.user_id,
    'claim'::text AS source_table,
    c.subject_type AS subject_kind,
    c.subject_id,
    'claim'::text AS category,
    c.attribute,
    c.value,
    NULL::uuid AS object_id,
    c.valid_from,
    c.valid_to,
    c.confidence,
    c.cardinality,
    c.review_by,
    c.source_type AS source_kind,
    c.source_id AS source_ref,
    'menerio'::text AS origin,
    'normal'::text AS rank,
    c.evidence_quote,
    c.created_at,
    c.updated_at
  FROM public.claims c;

GRANT SELECT ON public.world_claims TO authenticated, service_role;
