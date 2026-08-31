-- A promoted fact must not lose the fact that a human typed it.
--
-- WHY (found 2026-08-31, before anything was promoted). profile_entries has
-- an `origin` column and world_claims passes it through, and the hub reads it:
-- world-records.ts has HUMAN_ORIGINS = {'user_manual'} and stamps every
-- mirrored fact `written_by: human` or `written_by: machine` from it. That one
-- word is the whole protection behind world/menerio-bridge.md — "a background
-- job may re-file a hand-edited fact but may not change its words, demote it
-- or delete it" — and it is why `Location: UK` still says UK.
--
-- The claim arm of world_claims hardcoded 'menerio'::text as its origin,
-- because until now every claim really had been written by a machine. The
-- moment a promotion moves a user_manual entry into a claim, migration 097000
-- hides the entry arm and the claim arm answers in its place — as
-- `written_by: machine`. Michael's hand-typed value would arrive in the hub
-- stripped of the only marker that stops the next job overwriting it.
--
-- So claims carry an origin of their own, and the promotion copies the
-- entry's across. Nothing is demoted, because nothing loses its word.
--
-- Default 'menerio' keeps all 20 existing claims exactly where they are: they
-- were written by add_claim, which is a machine, and the view was already
-- calling them that.

ALTER TABLE public.claims
  ADD COLUMN IF NOT EXISTS origin text NOT NULL DEFAULT 'menerio';

COMMENT ON COLUMN public.claims.origin IS
  'Who wrote this fact: user_manual = the user typed it, and the hub then
   mirrors it as written_by: human and refuses to let a job change its words.
   Anything else is machine-written. Carried across unchanged when a profile
   entry is promoted into a claim.';

CREATE INDEX IF NOT EXISTS claims_origin_idx
  ON public.claims (user_id, origin);

-- Rebuild world_claims so the claim arm reports the real origin instead of
-- asserting 'menerio'. Every other line is identical to 20260901097000.
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
    -- The one changed line in this migration.
    c.origin,
    'normal'::text AS rank,
    c.evidence_quote,
    c.created_at,
    c.updated_at
  FROM public.claims c;

GRANT SELECT ON public.world_claims TO authenticated, service_role;
