-- Rollback for 20260901091000_world_claims_includes_claims.sql
--
-- Restores world_claims to its two-arm form, copied verbatim from
-- 20260816120000_9a3f61c2-4d70-4c88-9b21-7e0a5c1d3f84.sql lines 191-229.
--
-- Run this BEFORE 20260901090000_..._rollback.sql, because the widened view
-- selects claims.cardinality and claims.review_by and will block the column
-- drops while it exists.
--
-- Rolling this back does NOT lose any claim. It only makes the claims table
-- invisible to the hub mirror again, which is the state before 2026-09-01.
-- The next `world_pull.py --apply` will then delete the mirrored copies of
-- every claim-sourced file, so run the pull in dry-run first and read the
-- removal notice before applying it.

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

GRANT SELECT ON public.world_claims TO authenticated, service_role;
