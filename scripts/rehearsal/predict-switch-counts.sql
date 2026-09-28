-- Read-only PREDICTION of the switch's report (docs/plans/one-fact-store.md, A6),
-- for use before the dress rehearsal can run. Mirrors the switch's steps 3-7 in
-- plain SELECTs. Counts only. The attribute of an unlinked entry is
-- normalizeAttribute() (trim, lower case, whitespace → '-'), exactly; the
-- section of an unshown claim needs placeClaim() and is not predicted.
WITH
norm AS (SELECT e.*, lower(regexp_replace(btrim(e.label), '\s+', '-', 'g')) AS label_attr FROM profile_entries e),
fold AS (
  SELECT id, first_value(id) OVER w AS survivor FROM claims WHERE valid_to IS NULL
  WINDOW w AS (PARTITION BY user_id, subject_type, subject_id, attribute, lower(btrim(value))
               ORDER BY (origin = 'user_manual') DESC, created_at, id)),
folded AS (SELECT id, survivor FROM fold WHERE id <> survivor),
ent AS (
  SELECT e.id, e.user_id, e.rank, e.category_id,
         CASE WHEN e.contact_id IS NULL THEN 'self' ELSE 'contact' END AS st, e.contact_id AS sid,
         lower(btrim(e.value)) AS vkey,
         CASE WHEN c.id IS NULL THEN 'unlinked'
              WHEN lower(btrim(e.value)) <> lower(btrim(c.value))
                OR c.subject_type <> CASE WHEN e.contact_id IS NULL THEN 'self' ELSE 'contact' END
                OR c.subject_id IS DISTINCT FROM e.contact_id THEN 'differs'
              WHEN c.valid_to IS NOT NULL THEN 'closed' ELSE 'equal' END AS kind,
         CASE WHEN c.id IS NOT NULL THEN c.attribute
              WHEN e.label_attr IN ('relationship','relationships','related-to') THEN 'relationship-note'
              ELSE e.label_attr END AS attr,
         coalesce(f.survivor, c.id) AS claim_after_fold
    FROM norm e LEFT JOIN claims c ON c.id = e.derived_from_claim_id LEFT JOIN folded f ON f.id = c.id),
cand AS (
  SELECT x.*, EXISTS (SELECT 1 FROM claims c WHERE c.valid_to IS NULL AND c.user_id = x.user_id AND c.subject_type = x.st
                         AND c.subject_id IS NOT DISTINCT FROM x.sid AND c.attribute = x.attr AND lower(btrim(c.value)) = x.vkey) AS has_existing
    FROM ent x WHERE kind IN ('differs','unlinked')),
newkeys AS (SELECT DISTINCT user_id, st, sid, attr, vkey FROM cand WHERE NOT has_existing),
shown AS (  -- live claims some entry points at after the switch
  SELECT claim_after_fold AS id FROM ent WHERE kind IN ('equal','closed')
  UNION SELECT (SELECT coalesce(f.survivor, c.id) FROM claims c LEFT JOIN folded f ON f.id = c.id
                 WHERE c.valid_to IS NULL AND c.user_id = x.user_id AND c.subject_type = x.st AND c.subject_id IS NOT DISTINCT FROM x.sid
                   AND c.attribute = x.attr AND lower(btrim(c.value)) = x.vkey LIMIT 1)
    FROM cand x WHERE has_existing),
after_live AS (  -- live values after the switch: surviving claims plus new ones
  SELECT c.user_id, c.subject_type AS st, c.subject_id AS sid, c.attribute AS attr, c.cardinality AS card
    FROM claims c WHERE c.valid_to IS NULL AND c.subject_type <> 'entity' AND c.id NOT IN (SELECT id FROM folded)
  UNION ALL
  SELECT n.user_id, n.st, n.sid, n.attr, coalesce(ar.cardinality, 'one') FROM newkeys n LEFT JOIN attribute_rules ar ON ar.attribute = n.attr),
placed AS (
  SELECT x.user_id, x.st, x.sid, x.attr, bool_or(k.visibility_scope = 'private') AS anyp, bool_or(k.visibility_scope IS DISTINCT FROM 'private') AS anyo
    FROM ent x JOIN profile_categories k ON k.id = x.category_id GROUP BY 1,2,3,4)
SELECT jsonb_build_object(
  'predicted_step3_made_preferred', (SELECT count(*) FROM claims c WHERE c.origin = 'user_manual' OR EXISTS (
      SELECT 1 FROM ent x WHERE x.claim_after_fold = c.id AND x.kind = 'equal' AND x.rank = 'preferred')),
  'predicted_step4_folded_duplicates', (SELECT count(*) FROM folded),
  'predicted_step5_entries_equal', (SELECT count(*) FROM ent WHERE kind = 'equal'),
  'predicted_step5_entries_differs', (SELECT count(*) FROM ent WHERE kind = 'differs'),
  'predicted_step5_entries_closed', (SELECT count(*) FROM ent WHERE kind = 'closed'),
  'predicted_step5_entries_unlinked', (SELECT count(*) FROM ent WHERE kind = 'unlinked'),
  'predicted_step5_inserted', (SELECT count(*) FROM newkeys),
  'predicted_step5_folded_into_existing', (SELECT count(*) FROM cand) - (SELECT count(*) FROM newkeys),
  'predicted_step6_placed_private_by_most_private_wins', (SELECT count(*) FROM placed WHERE anyp AND anyo),
  'predicted_step7_unshown_kept', (SELECT count(*) FROM claims c WHERE c.valid_to IS NULL AND c.subject_type <> 'entity'
      AND c.id NOT IN (SELECT id FROM folded) AND c.id NOT IN (SELECT id FROM shown WHERE id IS NOT NULL)),
  'predicted_after_claims', (SELECT count(*) FROM claims) - (SELECT count(*) FROM folded) + (SELECT count(*) FROM newkeys),
  'predicted_two_answers_attributes', (SELECT count(*) FROM (SELECT 1 FROM after_live WHERE card = 'one'
      GROUP BY user_id, st, sid, attr HAVING count(*) > 1) x),
  'predicted_entries_in_private_sections', (SELECT count(*) FROM ent x JOIN profile_categories k ON k.id = x.category_id WHERE k.visibility_scope = 'private')
) AS prediction;
