-- Rollback for 20260901097000_world_claims_hides_promoted_entries.sql
--
-- ORDER. FIRST of the four 2026-09-01 rollbacks, run in descending number:
-- this, then 096000, then 095000, then 094000. Two hard constraints put it
-- first among everything on this date:
--
--   * It must run BEFORE 20260901093000_..._rollback.sql, which drops
--     profile_entries.derived_from_claim_id. The 097000 view references that
--     column in its WHERE clause, so Postgres refuses the column drop while
--     that view exists.
--   * It must run BEFORE 20260901091000_..._rollback.sql, which narrows
--     world_claims back to two arms. Running them the other way round
--     re-widens the view to three arms and undoes that rollback.
--
-- WHAT THIS COSTS. The single filtering line goes away, so a fact that was
-- promoted from a profile entry into a claim reaches the hub mirror TWICE
-- again: once undated from profile_entries, once dated from claims. Both
-- describe the same fact and the dated one is strictly better. The duplicate
-- is visible rather than dangerous — but `check-claim-conflicts.js` in the hub
-- may then report those pairs, so expect the conflict count to rise by roughly
-- the number of promoted facts.
--
-- THE derived_from_claim_id LINKS ARE DELIBERATELY LEFT IN PLACE.
--
-- 097000 also backfilled that column, and this does not clear it. Clearing it
-- would be actively wrong: the column is now written by the promotion path
-- (scripts/promote-profile-entries.ts) as well, and a blanket UPDATE ... SET
-- NULL cannot tell a link this migration made from one a promotion made
-- afterwards. Unlinking those resurrects a duplicate of every promoted fact
-- and loses the record of which claim displays which row.
--
-- Leaving them is safe in both directions. Once the view below no longer
-- filters on the column, the links are inert; and the 097000 backfill is
-- guarded by `WHERE derived_from_claim_id IS NULL`, so rolling forward again
-- is a no-op on rows that are already linked.
--
-- Restored verbatim from 20260901091000_world_claims_includes_claims.sql,
-- which is the immediately preceding definition of this view.

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
