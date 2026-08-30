-- A fact promoted from a profile entry into a claim must not appear twice.
--
-- profile_entries is now a display layer over claims (20260901093000), but
-- world_claims still emitted both arms unconditionally, so a promoted fact
-- reached the hub mirror as two files: the undated profile row and the dated
-- claim. Two files, one fact, and the dated one is strictly better.
--
-- The rule: a profile entry that names the claim it displays is suppressed
-- here, because the claim arm already carries that fact with dates, cardinality
-- and a review date. An entry with derived_from_claim_id IS NULL is still its
-- own record and still appears, so nothing that has not been promoted is lost.
--
-- This never deletes a profile entry. The row stays, the screens keep showing
-- it, and a hand-written value keeps its words: world/menerio-bridge.md says a
-- background job may RE-FILE a hand-edited fact but may not change or delete
-- it, and suppressing a duplicate view row is re-filing.

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

-- Link the one fact that has already been promoted by hand tonight: the
-- Duolingo streak existed as an undated profile entry and now exists as a
-- dated claim with a review date that has already passed.
UPDATE public.profile_entries p
SET derived_from_claim_id = c.id
FROM public.claims c
WHERE p.derived_from_claim_id IS NULL
  AND p.contact_id IS NULL
  AND c.user_id = p.user_id
  AND c.subject_type = 'self'
  AND lower(regexp_replace(btrim(p.label), '\s+', '-', 'g')) = lower(btrim(c.attribute))
  -- The claim must FULLY COVER the entry. Containment in either direction was
  -- the first version and it was wrong in a way that loses data: the Email
  -- entry holds two addresses and its claim held one, so a subset would have
  -- hidden its superset and the second address would have vanished from the
  -- mirror with nothing reporting it. A subset may never hide a superset.
  AND position(lower(btrim(p.value)) in lower(btrim(c.value))) > 0;

-- Two more, verified by eye on 2026-08-31, where the claim carries the same
-- fact but not the same string so the rule above correctly declined them:
-- the Duolingo entry is its claim plus the date the claim now holds in
-- valid_from, and the Email entry lists both addresses which now exist as two
-- many-valued claims. Neither row is deleted and neither value is changed.
UPDATE public.profile_entries p
SET derived_from_claim_id = c.id
FROM public.claims c
WHERE p.contact_id IS NULL
  AND p.derived_from_claim_id IS NULL
  AND c.user_id = p.user_id
  AND c.subject_type = 'self'
  AND (
    (lower(btrim(p.label)) = 'duolingo streak' AND c.attribute = 'duolingo-streak')
    OR (lower(btrim(p.label)) = 'email' AND c.attribute = 'email'
        AND c.value = 'michael@goodlightmag.com')
  );
