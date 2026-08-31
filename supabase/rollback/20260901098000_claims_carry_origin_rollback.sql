-- Rollback for 20260901098000_claims_carry_origin.sql
--
-- ORDER. Run this FIRST of everything dated 2026-09-01, before
-- 20260901097000_..._rollback.sql. The two rewrite the same view, and 097000's
-- rollback restores an OLDER definition of it; running them the other way
-- round would leave the older definition in place and then this one would put
-- the newer arm back on top of it.
--
-- Full descending order for the date: 099000, 098000 (here), 097000, 096000,
-- 095000, 094000, 093000, 092000, 091000, 090000.
--
-- WHAT THIS COSTS, AND CHECK IT BEFORE YOU RUN IT. The claim arm goes back to
-- asserting origin = 'menerio' for every claim. Any claim whose origin is
-- 'user_manual' — one the promotion moved out of a hand-typed profile entry —
-- then reaches the hub mirror as `written_by: machine`, which is the marker
-- that stops a background job rewriting a value Michael typed.
--
--   SELECT count(*) FROM public.claims WHERE origin = 'user_manual';
--
-- If that is not zero, the promoted entries must be un-promoted first (clear
-- their derived_from_claim_id so the profile_entries arm answers again, which
-- does carry the real origin), or those facts lose their protection silently.

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
  -- The one new line in this arm.
  WHERE p.derived_from_claim_id IS NULL

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

DROP INDEX IF EXISTS public.claims_origin_idx;

ALTER TABLE public.claims
  DROP COLUMN IF EXISTS origin;
