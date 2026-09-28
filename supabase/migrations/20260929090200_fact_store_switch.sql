-- One fact store, data switch (docs/plans/one-fact-store.md, A3 steps 1-13, B5).
--
-- Plain SQL over the live rows. It contains no data. Its inputs are two tables
-- already in the database: fact_label_map (written by build-fact-label-map) and
-- fact_unshown_drop (claim ids only). It needs …_fact_store_schema.sql first.
--
-- One transaction: the runner wraps it (no BEGIN/COMMIT here, so the A6 dress
-- rehearsal can run it inside BEGIN … ROLLBACK). Every count is an assertion
-- that RAISEs, which undoes everything. The counts are left in the temporary
-- table fact_switch_report for the rest of the session. No message and no
-- report row carries a value, a label or a name.
--
-- Rollback: supabase/rollback/fact_store_rollback.sql (needs the B1 snapshot).
--
-- Deviation from the plan's step 10, on purpose: the old entry triggers are not
-- dropped. They stay on the archive, disabled, and their functions move into
-- fact_retired with everything else this replaces. That keeps the archive
-- inert and lets the rollback put back exactly what was there.

-- 1. Flag, locks, old triggers off.
SET LOCAL menerio.fact_migration = 'on';
LOCK TABLE public.profile_entries, public.claims, public.fact_slots, public.profile_categories IN EXCLUSIVE MODE;
ALTER TABLE public.profile_entries DISABLE TRIGGER USER;

CREATE TEMP TABLE fact_switch_report (step text PRIMARY KEY, n bigint NOT NULL) ON COMMIT DROP;

CREATE TEMP TABLE _fs_before ON COMMIT DROP AS
SELECT 'claims'::text AS what, user_id, NULL::text AS kind, count(*) AS n FROM public.claims GROUP BY user_id
UNION ALL
SELECT 'pending_review', NULL, suggestion_type, count(*) FROM public.review_queue
 WHERE status IN ('pending','pending_review') GROUP BY suggestion_type;

INSERT INTO fact_switch_report VALUES
  ('before_claims', (SELECT count(*) FROM public.claims)),
  ('before_entries', (SELECT count(*) FROM public.profile_entries)),
  ('before_live_unshown', (SELECT count(*) FROM public.claims c WHERE c.valid_to IS NULL
      AND NOT EXISTS (SELECT 1 FROM public.profile_entries p WHERE p.derived_from_claim_id = c.id)));

-- Which entries sat in a private section, for the step 13 privacy assertion.
CREATE TEMP TABLE _fs_private_entries ON COMMIT DROP AS
SELECT e.id FROM public.profile_entries e JOIN public.profile_categories k ON k.id = e.category_id
 WHERE k.visibility_scope = 'private';

-- 2. Pre-checks.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.fact_slots) THEN
    RAISE EXCEPTION 'fact_switch_precheck: fact_slots is not empty (something wrote during the pause)';
  END IF;
  IF EXISTS (SELECT 1 FROM public.profile_entries e
              WHERE NOT EXISTS (SELECT 1 FROM public.fact_label_map m WHERE m.kind = 'label' AND m.key = e.label)) THEN
    RAISE EXCEPTION 'fact_switch_precheck: % entry labels are missing from fact_label_map (re-run build-fact-label-map)',
      (SELECT count(DISTINCT e.label) FROM public.profile_entries e
        WHERE NOT EXISTS (SELECT 1 FROM public.fact_label_map m WHERE m.kind = 'label' AND m.key = e.label));
  END IF;
  IF EXISTS (SELECT 1 FROM public.claims c
              WHERE NOT EXISTS (SELECT 1 FROM public.fact_label_map m WHERE m.kind = 'attribute' AND m.key = c.attribute)) THEN
    RAISE EXCEPTION 'fact_switch_precheck: % claim attributes are missing from fact_label_map (re-run build-fact-label-map)',
      (SELECT count(DISTINCT c.attribute) FROM public.claims c
        WHERE NOT EXISTS (SELECT 1 FROM public.fact_label_map m WHERE m.kind = 'attribute' AND m.key = c.attribute));
  END IF;
  IF EXISTS (SELECT 1 FROM public.fact_unshown_drop d
              WHERE NOT EXISTS (SELECT 1 FROM public.claims c WHERE c.id = d.claim_id AND c.valid_to IS NULL
                                   AND c.subject_type <> 'entity')
                 OR EXISTS (SELECT 1 FROM public.profile_entries p WHERE p.derived_from_claim_id = d.claim_id)) THEN
    RAISE EXCEPTION 'fact_switch_precheck: fact_unshown_drop holds an id that is not a live, unshown claim';
  END IF;
  IF EXISTS (SELECT 1 FROM public.profile_entries e JOIN public.claims c ON c.id = e.id) THEN
    RAISE EXCEPTION 'fact_switch_precheck: an entry id is already a claim id';
  END IF;
END $$;

-- 3. Protect what a human typed.
WITH p AS (
  UPDATE public.claims c SET rank = 'preferred'
   WHERE c.rank <> 'preferred'
     AND (c.origin = 'user_manual' OR EXISTS (
           SELECT 1 FROM public.profile_entries e
            WHERE e.derived_from_claim_id = c.id AND e.rank = 'preferred'
              AND lower(btrim(e.value)) = lower(btrim(c.value))
              AND c.subject_type = CASE WHEN e.contact_id IS NULL THEN 'self' ELSE 'contact' END
              AND c.subject_id IS NOT DISTINCT FROM e.contact_id))
  RETURNING 1)
INSERT INTO fact_switch_report SELECT 'step3_made_preferred', count(*) FROM p;

-- 4. Fold duplicate live claims (B8): keep the preferred, else the user_manual,
-- else the earliest. The survivor is preferred if any copy was.
CREATE TEMP TABLE _fs_fold ON COMMIT DROP AS
SELECT id, survivor, any_preferred FROM (
  SELECT c.id,
         first_value(c.id) OVER w AS survivor,
         bool_or(c.rank = 'preferred') OVER (PARTITION BY c.user_id, c.subject_type, c.subject_id, c.attribute, lower(btrim(c.value))) AS any_preferred
    FROM public.claims c
   WHERE c.valid_to IS NULL
  WINDOW w AS (PARTITION BY c.user_id, c.subject_type, c.subject_id, c.attribute, lower(btrim(c.value))
               ORDER BY (c.rank = 'preferred') DESC, (c.origin = 'user_manual') DESC, c.created_at, c.id)
) x
WHERE id <> survivor;

UPDATE public.claims c SET rank = 'preferred'
  FROM (SELECT DISTINCT survivor FROM _fs_fold WHERE any_preferred) f
 WHERE c.id = f.survivor AND c.rank <> 'preferred';

-- Entries that showed a folded copy now show the survivor. They are "folded".
CREATE TEMP TABLE _fs_folded_entries (entry_id uuid PRIMARY KEY) ON COMMIT DROP;
WITH moved AS (
  UPDATE public.profile_entries e SET derived_from_claim_id = f.survivor
    FROM _fs_fold f WHERE e.derived_from_claim_id = f.id
  RETURNING e.id)
INSERT INTO _fs_folded_entries SELECT id FROM moved;

DELETE FROM public.claims WHERE id IN (SELECT id FROM _fs_fold);
INSERT INTO fact_switch_report SELECT 'step4_folded_duplicates', count(*) FROM _fs_fold;

-- 5. Entries → claims.
CREATE TEMP TABLE _fs_entry ON COMMIT DROP AS
SELECT e.id, e.user_id,
       CASE WHEN e.contact_id IS NULL THEN 'self' ELSE 'contact' END AS subject_type,
       e.contact_id AS subject_id,
       e.value, lower(btrim(e.value)) AS vkey, e.origin, e.rank, e.evidence_quote, e.linked_note_id,
       coalesce(e.created_at, now()) AS created_at,
       CASE
         WHEN c.id IS NULL THEN 'unlinked'
         WHEN lower(btrim(e.value)) <> lower(btrim(c.value))
           OR c.subject_type <> CASE WHEN e.contact_id IS NULL THEN 'self' ELSE 'contact' END
           OR c.subject_id IS DISTINCT FROM e.contact_id THEN 'differs'
         WHEN c.valid_to IS NOT NULL THEN 'closed'
         ELSE 'equal'
       END AS kind,
       CASE WHEN c.id IS NOT NULL THEN c.attribute ELSE m.attribute END AS attribute
  FROM public.profile_entries e
  LEFT JOIN public.claims c ON c.id = e.derived_from_claim_id
  LEFT JOIN public.fact_label_map m ON m.kind = 'label' AND m.key = e.label;

INSERT INTO fact_switch_report SELECT 'step5_entries_' || kind, count(*) FROM _fs_entry GROUP BY kind;

-- The entries that need a claim of their own, and the identical live value
-- that may already exist for their subject and attribute.
CREATE TEMP TABLE _fs_cand ON COMMIT DROP AS
SELECT x.*,
       (SELECT c.id FROM public.claims c
         WHERE c.user_id = x.user_id AND c.subject_type = x.subject_type
           AND c.subject_id IS NOT DISTINCT FROM x.subject_id
           AND c.attribute = x.attribute AND lower(btrim(c.value)) = x.vkey AND c.valid_to IS NULL
         ORDER BY c.created_at, c.id LIMIT 1) AS existing
  FROM _fs_entry x
 WHERE x.kind IN ('differs', 'unlinked');

-- One new claim per value: two entries that map to one live value become one
-- claim. The chosen entry is the preferred one, else the earliest; its id
-- becomes the claim's id.
CREATE TEMP TABLE _fs_new ON COMMIT DROP AS
SELECT DISTINCT ON (user_id, subject_type, subject_id, attribute, vkey) *
  FROM _fs_cand WHERE existing IS NULL
 ORDER BY user_id, subject_type, subject_id, attribute, vkey, (rank = 'preferred') DESC, created_at, id;

INSERT INTO public.claims (id, user_id, subject_type, subject_id, attribute, value, valid_from, valid_to,
                           confidence, cardinality, source_type, source_id, created_at, updated_at,
                           evidence_quote, origin, rank)
SELECT n.id, n.user_id, n.subject_type, n.subject_id, n.attribute, n.value, NULL, NULL,
       'likely', coalesce(ar.cardinality, 'one'),
       CASE WHEN n.linked_note_id IS NOT NULL THEN 'note' WHEN n.origin = 'user_manual' THEN 'manual' ELSE 'ai' END,
       n.linked_note_id, n.created_at, now(), n.evidence_quote, n.origin, n.rank
  FROM _fs_new n
  LEFT JOIN public.attribute_rules ar ON ar.attribute = n.attribute;

INSERT INTO fact_switch_report
SELECT 'step5_inserted_' || kind, count(*) FROM _fs_new GROUP BY kind;

-- Point every candidate at its claim: the existing identical value, or the new one.
CREATE TEMP TABLE _fs_target ON COMMIT DROP AS
SELECT c.id AS entry_id, c.rank,
       coalesce(c.existing, n.id) AS claim_id,
       (c.existing IS NOT NULL OR n.id <> c.id) AS folded
  FROM _fs_cand c
  LEFT JOIN _fs_new n
    ON c.existing IS NULL AND n.user_id = c.user_id AND n.subject_type = c.subject_type
   AND n.subject_id IS NOT DISTINCT FROM c.subject_id AND n.attribute = c.attribute AND n.vkey = c.vkey;

UPDATE public.profile_entries e SET derived_from_claim_id = t.claim_id
  FROM _fs_target t WHERE e.id = t.entry_id;
UPDATE public.claims c SET rank = 'preferred'
  FROM _fs_target t WHERE t.claim_id = c.id AND t.rank = 'preferred' AND c.rank <> 'preferred';
INSERT INTO _fs_folded_entries SELECT entry_id FROM _fs_target WHERE folded ON CONFLICT DO NOTHING;
INSERT INTO fact_switch_report SELECT 'step5_folded_into_existing', count(*) FROM _fs_target WHERE folded;

-- 6. Slots, one per (subject, attribute) that entries show.
CREATE TEMP TABLE _fs_placed ON COMMIT DROP AS
SELECT c.user_id, c.subject_type, c.subject_id, c.attribute,
       e.label, k.slug, (k.visibility_scope = 'private') AS private, (e.rank = 'preferred') AS pref,
       e.is_pinned, e.show_to_agent, coalesce(e.created_at, now()) AS created_at
  FROM public.profile_entries e
  JOIN public.claims c ON c.id = e.derived_from_claim_id
  JOIN public.profile_categories k ON k.id = e.category_id;

INSERT INTO public.fact_slots (user_id, subject_type, subject_id, attribute, label, category_slug, cardinality, is_pinned, show_to_agent)
SELECT g.user_id, g.subject_type, g.subject_id, g.attribute,
       (SELECT p.label FROM _fs_placed p
         WHERE p.user_id = g.user_id AND p.subject_type = g.subject_type
           AND p.subject_id IS NOT DISTINCT FROM g.subject_id AND p.attribute = g.attribute
         GROUP BY p.label ORDER BY bool_or(p.pref) DESC, count(*) DESC, min(p.created_at), p.label LIMIT 1),
       -- The most private placement wins, then the preferred row's, then the most frequent.
       (SELECT p.slug FROM _fs_placed p
         WHERE p.user_id = g.user_id AND p.subject_type = g.subject_type
           AND p.subject_id IS NOT DISTINCT FROM g.subject_id AND p.attribute = g.attribute
         GROUP BY p.slug ORDER BY bool_or(p.private) DESC, bool_or(p.pref) DESC, count(*) DESC, min(p.created_at), p.slug LIMIT 1),
       NULL, g.pinned, g.agent
  FROM (SELECT user_id, subject_type, subject_id, attribute, bool_or(is_pinned) AS pinned, bool_or(show_to_agent) AS agent
          FROM _fs_placed GROUP BY 1, 2, 3, 4) g;

INSERT INTO fact_switch_report VALUES
  ('step6_slots_from_entries', (SELECT count(*) FROM public.fact_slots)),
  ('step6_placed_private_by_most_private_wins', (
    SELECT count(*) FROM (SELECT 1 FROM _fs_placed GROUP BY user_id, subject_type, subject_id, attribute
                           HAVING bool_or(private) AND bool_or(NOT private)) x));

-- 7. Live claims no page showed (B6). Michael's rule (2026-09-28): a solid fact
-- is shown, garbage is deleted, nobody reviews a list. Deleted, each with a
-- suppression row so it is not suggested again (the B1 snapshot keeps them):
--   * the ids in fact_unshown_drop;
--   * placeholders ("none", "unknown", …) and values that repeat the attribute;
--   * a value the page already shows for the same subject under another label;
--   * a machine's fact without a source quote (not typed by a human, not
--     accepted from the review queue, no 10-character quote).
-- Everything else gets a slot from the map and appears on the page.
CREATE TEMP TABLE _fs_drop ON COMMIT DROP AS
SELECT c.id,
       CASE
         WHEN EXISTS (SELECT 1 FROM public.fact_unshown_drop d WHERE d.claim_id = c.id) THEN 'listed'
         WHEN lower(btrim(c.value)) IN ('', 'none', 'n/a', 'na', 'unknown', 'unspecified', '-', '—', 'null')
           OR lower(btrim(c.value)) ~ '^(none|n/?a|unknown|unspecified)\s*[.!]?$'
           OR lower(btrim(c.value)) IN (lower(btrim(c.attribute)), replace(lower(btrim(c.attribute)), '-', ' ')) THEN 'placeholder'
         -- Shown as current: an entry that shows a closed claim shows history,
         -- and the live copy of that value is the only current one.
         WHEN EXISTS (SELECT 1 FROM public.profile_entries p JOIN public.claims s ON s.id = p.derived_from_claim_id
                       WHERE s.user_id = c.user_id AND s.subject_type = c.subject_type
                         AND s.subject_id IS NOT DISTINCT FROM c.subject_id AND s.valid_to IS NULL
                         AND lower(btrim(s.value)) = lower(btrim(c.value))) THEN 'already_shown'
         WHEN c.origin NOT IN ('user_manual', 'review_queue') AND c.rank <> 'preferred'
          AND length(btrim(coalesce(c.evidence_quote, ''))) < 10 THEN 'no_source'
       END AS reason
  FROM public.claims c
 WHERE c.valid_to IS NULL AND c.subject_type <> 'entity'
   AND NOT EXISTS (SELECT 1 FROM public.profile_entries p WHERE p.derived_from_claim_id = c.id);
DELETE FROM _fs_drop WHERE reason IS NULL;

INSERT INTO public.ai_suggestion_suppressions (user_id, suggestion_type, target_entity_type, target_entity_id,
                                               normalized_value, suppression_key)
SELECT c.user_id, 'claim', 'claim', c.id, lower(btrim(c.value)),
       c.subject_type || ':' || coalesce(c.subject_id::text, '') || ':' || c.attribute || ':' || lower(btrim(c.value))
  FROM public.claims c JOIN _fs_drop d ON d.id = c.id
ON CONFLICT (user_id, suppression_key) DO NOTHING;
INSERT INTO fact_switch_report SELECT 'step7_dropped_' || reason, count(*) FROM _fs_drop GROUP BY reason;
WITH dropped AS (DELETE FROM public.claims c USING _fs_drop d WHERE c.id = d.id RETURNING 1)
INSERT INTO fact_switch_report SELECT 'step7_unshown_dropped', count(*) FROM dropped;

INSERT INTO fact_switch_report
SELECT 'step7_unshown_kept', count(*) FROM public.claims c
 WHERE c.valid_to IS NULL AND c.subject_type <> 'entity'
   AND NOT EXISTS (SELECT 1 FROM public.profile_entries p WHERE p.derived_from_claim_id = c.id);

WITH added AS (
  INSERT INTO public.fact_slots (user_id, subject_type, subject_id, attribute, label, category_slug)
  SELECT DISTINCT ON (c.user_id, c.subject_type, c.subject_id, c.attribute)
         c.user_id, c.subject_type, c.subject_id, c.attribute, m.label, m.category_slug
    FROM public.claims c
    JOIN public.fact_label_map m ON m.kind = 'attribute' AND m.key = c.attribute
   WHERE c.subject_type <> 'entity'
     AND NOT EXISTS (SELECT 1 FROM public.fact_slots s
                      WHERE s.user_id = c.user_id AND s.subject_type = c.subject_type
                        AND s.subject_id IS NOT DISTINCT FROM c.subject_id AND s.attribute = c.attribute)
   ORDER BY c.user_id, c.subject_type, c.subject_id, c.attribute
  RETURNING user_id, subject_type, subject_id, category_slug)
INSERT INTO fact_switch_report
SELECT 'step7_slots_added', count(*) FROM added
UNION ALL
SELECT 'step7_slots_added_into_private_section', count(*) FROM added a
 WHERE EXISTS (SELECT 1 FROM public.profile_categories k
                WHERE k.user_id = a.user_id AND k.slug = a.category_slug AND k.visibility_scope = 'private'
                  AND k.contact_id IS NOT DISTINCT FROM a.subject_id);

-- 7b. No "two answers" left (Michael's rule, 2026-09-28). For each subject and
-- single-valued attribute with more than one current value:
--   * if the page already listed two or more of those values, the attribute
--     keeps all of them (slot cardinality 'many');
--   * if a value a human typed would lose, the same, so no human fact is closed;
--   * otherwise the value the page showed wins, else the newest, and the others
--     become history (valid_to = the user's today). Nothing is deleted.
CREATE TEMP TABLE _fs_conflict ON COMMIT DROP AS
SELECT c.id, c.user_id, c.subject_type, c.subject_id, c.attribute, c.rank,
       EXISTS (SELECT 1 FROM public.profile_entries p WHERE p.derived_from_claim_id = c.id) AS shown,
       row_number() OVER (PARTITION BY c.user_id, c.subject_type, c.subject_id, c.attribute
         ORDER BY EXISTS (SELECT 1 FROM public.profile_entries p WHERE p.derived_from_claim_id = c.id) DESC,
                  (c.rank = 'preferred') DESC, c.valid_from DESC NULLS LAST, c.created_at DESC, c.id) AS place
  FROM public.profile_facts f JOIN public.claims c ON c.id = f.claim_id
 WHERE f.has_conflict AND f.is_current;

CREATE TEMP TABLE _fs_conflict_groups ON COMMIT DROP AS
SELECT user_id, subject_type, subject_id, attribute,
       (count(*) FILTER (WHERE shown) >= 2 OR bool_or(rank = 'preferred' AND place > 1)) AS keep_all
  FROM _fs_conflict GROUP BY 1, 2, 3, 4;

WITH made_many AS (
  UPDATE public.fact_slots s SET cardinality = 'many'
    FROM _fs_conflict_groups g
   WHERE g.keep_all AND s.user_id = g.user_id AND s.subject_type = g.subject_type
     AND s.subject_id IS NOT DISTINCT FROM g.subject_id AND s.attribute = g.attribute
  RETURNING 1)
INSERT INTO fact_switch_report SELECT 'step7b_two_answers_kept_as_several', count(*) FROM made_many;

-- The ids are kept (in fact_retired, with the archive) so the rollback can tell
-- the switch's own changes from facts changed after go-live.
CREATE TABLE fact_retired.switch_closed_claims (claim_id uuid PRIMARY KEY);
WITH closed AS (
  UPDATE public.claims c SET valid_to = public.fact_today(c.user_id)
    FROM _fs_conflict x JOIN _fs_conflict_groups g
      ON g.user_id = x.user_id AND g.subject_type = x.subject_type
     AND g.subject_id IS NOT DISTINCT FROM x.subject_id AND g.attribute = x.attribute
   WHERE c.id = x.id AND x.place > 1 AND NOT g.keep_all
  RETURNING c.id)
INSERT INTO fact_retired.switch_closed_claims SELECT id FROM closed;
INSERT INTO fact_switch_report SELECT 'step7b_two_answers_older_made_history', count(*) FROM fact_retired.switch_closed_claims;

-- 8. One live copy of a value per subject and attribute.
CREATE UNIQUE INDEX claims_one_live_value ON public.claims
  (user_id, subject_type, coalesce(subject_id, '00000000-0000-0000-0000-000000000000'::uuid),
   attribute, md5(lower(btrim(value))))
  WHERE valid_to IS NULL;

-- 9. world_claims: agent_facts plus relationships (3.4). The old view moves to
-- fact_retired; it keeps reading the archive, and the rollback moves it back.
ALTER VIEW public.world_claims SET SCHEMA fact_retired;
CREATE VIEW public.world_claims WITH (security_invoker = on) AS
  SELECT f.claim_id AS id, f.user_id, 'claim'::text AS source_table, f.subject_type AS subject_kind, f.subject_id,
         coalesce(f.category_slug, 'other') AS category, f.attribute, f.value, NULL::uuid AS object_id,
         f.valid_from, f.valid_to, f.confidence, f.cardinality, f.review_by,
         f.source_type AS source_kind, f.source_id AS source_ref, f.origin, f.rank,
         f.evidence_quote, f.created_at, f.updated_at
    FROM public.agent_facts f
  UNION ALL
  SELECT r.id, r.user_id, 'contact_relationship', r.source_type, r.source_id, 'relationship',
         'relationship', COALESCE(NULLIF(btrim(r.custom_label), ''), r.label), r.target_id,
         r.valid_from, r.valid_to, 'likely', 'many', NULL::date, NULL::text, NULL::uuid,
         r.origin, r.rank, r.evidence_quote, r.created_at, r.updated_at
    FROM public.contact_relationships r;
GRANT SELECT ON public.world_claims TO anon, authenticated, service_role;

-- 10. Retire the old table. Its triggers stay, disabled (see the header).
ALTER TABLE public.profile_entries DROP CONSTRAINT profile_entries_derived_from_claim_id_fkey;
ALTER TABLE public.profile_entries DROP CONSTRAINT profile_entries_category_id_fkey;
ALTER TABLE public.profile_entries RENAME TO profile_entries_archive;
REVOKE ALL ON public.profile_entries_archive FROM anon, authenticated;

-- Functions that read profile_entries and have no caller left (A1 run, finding 5).
ALTER FUNCTION public.handle_profile_entries_enqueue_normalization() SET SCHEMA fact_retired;
ALTER FUNCTION public.profile_entries_atomize() SET SCHEMA fact_retired;
ALTER FUNCTION public.profile_entry_canonicalize() SET SCHEMA fact_retired;
ALTER FUNCTION public.profile_entries_mark_audit_dirty() SET SCHEMA fact_retired;
ALTER FUNCTION public.profile_entries_prevent_duplicate_fact() SET SCHEMA fact_retired;
ALTER FUNCTION public.profile_entry_quality_guard() SET SCHEMA fact_retired;
ALTER FUNCTION public.profile_entry_end_claim() SET SCHEMA fact_retired;
ALTER FUNCTION public.profile_entry_require_origin() SET SCHEMA fact_retired;
ALTER FUNCTION public.profile_entry_sync_claim() SET SCHEMA fact_retired;
ALTER FUNCTION public.backfill_accumulator_profile_entries() SET SCHEMA fact_retired;
ALTER FUNCTION public.cleanup_profile_duplicates(uuid, uuid) SET SCHEMA fact_retired;
ALTER FUNCTION public.cleanup_profile_token_duplicates() SET SCHEMA fact_retired;
ALTER FUNCTION public.profile_dedup_sweep(uuid, uuid, boolean) SET SCHEMA fact_retired;
ALTER FUNCTION public.profile_subset_label_sweep(uuid, uuid, boolean) SET SCHEMA fact_retired;
ALTER FUNCTION public.profile_existing_token_keys(uuid, uuid, text, uuid) SET SCHEMA fact_retired;
ALTER FUNCTION public.profile_resolve_label(uuid, uuid, uuid, text, text) SET SCHEMA fact_retired;
ALTER FUNCTION public.profile_entries_dedup_before_insert() SET SCHEMA fact_retired;
ALTER FUNCTION public.profile_audit_apply_merge(uuid, uuid, uuid[], text, text, text) SET SCHEMA fact_retired;
ALTER FUNCTION public.profile_audit_rollback_merge(uuid) SET SCHEMA fact_retired;

-- 11. Origin guard on; merge moves claims, slots and private sections.
CREATE TRIGGER trg_claims_c_require_origin BEFORE INSERT OR UPDATE ON public.claims
  FOR EACH ROW EXECUTE FUNCTION public.claim_require_origin();

-- contact_merge_move_references without its claims UPDATE (A1 run, finding 2):
-- the merge folds and moves claims itself, before it sets merged_into.
DROP TRIGGER contact_merge_move_references ON public.contacts;
ALTER FUNCTION public.contact_merge_move_references() SET SCHEMA fact_retired;
CREATE FUNCTION public.contact_merge_move_references() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
BEGIN
  UPDATE public.moments
     SET person_id = NEW.merged_into
   WHERE user_id = NEW.user_id AND person_id = NEW.id;

  INSERT INTO public.moment_participants (moment_id, person_id)
  SELECT mp.moment_id, NEW.merged_into
    FROM public.moment_participants mp
    JOIN public.moments m ON m.id = mp.moment_id AND m.user_id = NEW.user_id
   WHERE mp.person_id = NEW.id
  ON CONFLICT DO NOTHING;
  DELETE FROM public.moment_participants mp
   USING public.moments m
   WHERE m.id = mp.moment_id AND m.user_id = NEW.user_id AND mp.person_id = NEW.id;

  UPDATE public.person_documents
     SET person_id = NEW.merged_into
   WHERE user_id = NEW.user_id AND person_id = NEW.id;

  UPDATE public.collection_items
     SET contact_id = NEW.merged_into
   WHERE user_id = NEW.user_id AND contact_id = NEW.id;

  -- Claims and fact slots are moved by merge_contacts_atomic, which folds
  -- identical live values first (claims_one_live_value).
  RETURN NULL;
END;
$function$;
REVOKE ALL ON FUNCTION public.contact_merge_move_references() FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.contact_merge_move_references() TO service_role;
CREATE TRIGGER contact_merge_move_references AFTER UPDATE OF merged_into ON public.contacts
  FOR EACH ROW WHEN (((old.merged_into IS NULL) AND (new.merged_into IS NOT NULL) AND (new.merged_into <> new.id)))
  EXECUTE FUNCTION public.contact_merge_move_references();

-- merge_contacts_atomic, from its live text. Changed: the snapshot records
-- claims and slots instead of entries; claims and slots move (identical live
-- values folded, the preferred copy kept, pins combined, the most private
-- placement winning), also on a merge into self; sections carry across, the
-- most private scope winning; "Also known as" becomes a claim.
ALTER FUNCTION public.merge_contacts_atomic(uuid, uuid, uuid, boolean) SET SCHEMA fact_retired;
CREATE FUNCTION public.merge_contacts_atomic(p_request_id uuid, p_source_contact_id uuid, p_target_contact_id uuid DEFAULT NULL::uuid, p_merge_into_self boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
 u uuid:=auth.uid(); s public.contacts; t public.contacts; c record; e record; n record; k record; sl record;
 dest uuid; dest_type text; rel_source uuid; rel_target uuid; rel_source_type text; rel_target_type text; meta jsonb; arr jsonb; result_json jsonb; snapshot jsonb;
 payload_json jsonb:=jsonb_build_object('source',p_source_contact_id,'target',p_target_contact_id,'self',p_merge_into_self);
 receipt public.contact_merge_receipts; names text[]; mappings jsonb; pair record;
begin
 if u is null then raise exception 'Authentication required' using errcode='42501'; end if;
 if p_request_id is null or p_source_contact_id is null or p_merge_into_self is null
 or (p_merge_into_self and p_target_contact_id is not null)
 or (not p_merge_into_self and (p_target_contact_id is null or p_source_contact_id=p_target_contact_id)) then
  raise exception 'Invalid merge request' using errcode='22023';
 end if;
 -- Exclusive first: the existing contact statement trigger takes this same lock.
 -- Acquiring shared then upgrading after row locks would deadlock topic commands.
 perform pg_advisory_xact_lock(hashtextextended('contact-topics-lifecycle',0));
 perform pg_advisory_xact_lock(hashtextextended('contact-topics:'||u::text,0));
 select * into receipt from public.contact_merge_receipts where user_id=u and request_id=p_request_id;
 if found then
  if receipt.payload<>payload_json then raise exception 'Request ID already used for another merge' using errcode='22023'; end if;
  return receipt.result||jsonb_build_object('replayed',true);
 end if;
 perform id from public.contacts where user_id=u and id in(p_source_contact_id,p_target_contact_id) order by id for update;
 select * into s from public.contacts where id=p_source_contact_id and user_id=u;
 if not found or s.merged_into is not null then raise exception 'Source not found or already merged' using errcode='PT409'; end if;
 if s.topic_self_merge_pending and not p_merge_into_self then raise exception 'Finish the earlier self merge first' using errcode='PT409'; end if;
 dest:=case when p_merge_into_self then null else p_target_contact_id end;
 dest_type:=case when p_merge_into_self then 'self' else 'contact' end;
 if p_merge_into_self then
  if exists(select from public.contact_topics where user_id=u and contact_id=s.id) then
   raise exception 'Reassign conversation topics before merging into yourself' using errcode='PT409';
  end if;
 else
  select * into t from public.contacts where id=dest and user_id=u;
  if not found or t.merged_into is not null or t.topic_self_merge_pending then raise exception 'Target not found or already merged' using errcode='PT409'; end if;
 end if;
 -- Keep exact source records in an owner-readable immutable receipt.
 snapshot:=jsonb_build_object('contact',to_jsonb(s),
  'categories',coalesce((select jsonb_agg(to_jsonb(x)) from public.profile_categories x where user_id=u and contact_id=s.id),'[]'::jsonb),
  'relationships',coalesce((select jsonb_agg(to_jsonb(x)) from public.contact_relationships x where user_id=u),'[]'::jsonb),
  'memberships',coalesce((select jsonb_agg(to_jsonb(x)) from public.contact_group_memberships x where user_id=u and contact_id=s.id),'[]'::jsonb),
  'claims',coalesce((select jsonb_agg(to_jsonb(x)-'embedding') from public.claims x where user_id=u and subject_type='contact' and subject_id=s.id),'[]'::jsonb),
  'slots',coalesce((select jsonb_agg(to_jsonb(x)) from public.fact_slots x where user_id=u and subject_type='contact' and subject_id=s.id),'[]'::jsonb));
 names:=array(select lower(x) from unnest(array[s.name]||coalesce(s.aliases,'{}'::text[])) x);
 if not p_merge_into_self then
  mappings:=coalesce(t.app_mappings,'{}'::jsonb);
  for pair in select * from jsonb_each(coalesce(s.app_mappings,'{}'::jsonb)) loop
   if coalesce(mappings->pair.key->>'display_name','')='' then mappings:=mappings||jsonb_build_object(pair.key,pair.value); end if;
  end loop;
  update public.contacts set aliases=array(select distinct x from unnest(coalesce(t.aliases,'{}'::text[])||array[s.name]||coalesce(s.aliases,'{}'::text[])) x where x is not null and lower(x)<>lower(t.name)),
   app_mappings=mappings, notes=case when nullif(trim(s.notes),'') is null then t.notes when nullif(trim(t.notes),'') is null then s.notes else t.notes||E'\n\n--- Merged from '||s.name||E' ---\n'||s.notes end where id=dest;
 end if;

 -- Claims: fold identical live values (keep the preferred copy, else the
 -- destination's), then move everything, history included.
 for e in select * from public.claims where user_id=u and subject_type='contact' and subject_id=s.id and valid_to is null order by id for update loop
  select * into k from public.claims where user_id=u and subject_type=dest_type and subject_id is not distinct from dest
   and attribute=e.attribute and lower(btrim(value))=lower(btrim(e.value)) and valid_to is null for update;
  if found then
   if e.rank='preferred' and k.rank<>'preferred' then delete from public.claims where id=k.id;
   else delete from public.claims where id=e.id; end if;
  end if;
 end loop;
 update public.claims set subject_type=dest_type, subject_id=dest where user_id=u and subject_type='contact' and subject_id=s.id;
 if exists(select from public.claims where user_id=u and subject_type='contact' and subject_id=s.id) then raise exception 'Unmoved claims' using errcode='PT409'; end if;

 -- Slots: the destination's wins, pins combined, the most private placement wins.
 for e in select * from public.fact_slots where user_id=u and subject_type='contact' and subject_id=s.id order by id for update loop
  select * into sl from public.fact_slots where user_id=u and subject_type=dest_type and subject_id is not distinct from dest and attribute=e.attribute for update;
  if found then
   update public.fact_slots set is_pinned=sl.is_pinned or e.is_pinned, show_to_agent=sl.show_to_agent or e.show_to_agent,
    category_slug=case
     when exists(select from public.profile_categories where user_id=u and contact_id=s.id and slug=e.category_slug and visibility_scope='private')
      and not exists(select from public.profile_categories where user_id=u and contact_id is not distinct from dest and slug=sl.category_slug and visibility_scope='private')
     then e.category_slug else sl.category_slug end
    where id=sl.id;
   delete from public.fact_slots where id=e.id;
  else
   update public.fact_slots set subject_type=dest_type, subject_id=dest where id=e.id;
  end if;
 end loop;

 -- Sections: move, or fold into the destination's, the most private scope winning.
 for c in select * from public.profile_categories where user_id=u and contact_id=s.id order by id for update loop
  select * into k from public.profile_categories where user_id=u and contact_id is not distinct from dest and slug=c.slug order by id limit 1 for update;
  if not found then
   update public.profile_categories set contact_id=dest where id=c.id;
  else
   if c.visibility_scope='private' and coalesce(k.visibility_scope,'all')<>'private' then
    update public.profile_categories set visibility_scope='private' where id=k.id;
   end if;
   delete from public.profile_categories where id=c.id;
  end if;
 end loop;

 if p_merge_into_self then
  insert into public.claims(user_id,subject_type,subject_id,attribute,value,confidence,cardinality,source_type,origin,rank)
   select distinct on (lower(btrim(x))) u,'self',null,'also-known-as',btrim(x),'certain','many','manual','user_manual','preferred'
     from unnest(array[s.name]||coalesce(s.aliases,'{}'::text[])) x
    where nullif(trim(x),'') is not null
      and not exists(select from public.claims z where z.user_id=u and z.subject_type='self' and z.attribute='also-known-as'
                      and lower(btrim(z.value))=lower(btrim(x)) and z.valid_to is null);
  insert into public.fact_slots(user_id,subject_type,subject_id,attribute,label,category_slug,cardinality)
   select u,'self',null,'also-known-as','Also known as','identity','many'
    where not exists(select from public.fact_slots where user_id=u and subject_type='self' and attribute='also-known-as');
 end if;
 update public.action_items set contact_id=dest where user_id=u and contact_id=s.id;
 update public.contact_interactions set contact_id=dest where user_id=u and contact_id=s.id;
 for e in select * from public.contact_group_memberships where user_id=u and contact_id=s.id order by id for update loop
  if dest is null or exists(select from public.contact_group_memberships where user_id=u and contact_id=dest and group_id=e.group_id) then
   delete from public.contact_group_memberships where id=e.id;
  else
   update public.contact_group_memberships set contact_id=dest where id=e.id;
  end if;
 end loop;
 for e in select * from public.contact_relationships where user_id=u and (source_id=s.id or target_id=s.id) order by id for update loop
  rel_source:=case when e.source_id=s.id then dest else e.source_id end;
  rel_target:=case when e.target_id=s.id then dest else e.target_id end;
  rel_source_type:=case when rel_source is null then 'self' else 'contact' end;
  rel_target_type:=case when rel_target is null then 'self' else 'contact' end;
  if rel_source is not distinct from rel_target or exists(
   select from public.contact_relationships r where r.user_id=u and r.id<>e.id
   and public.relationship_pair_key(u,r.source_type,r.source_id,r.target_type,r.target_id,r.label)
     =public.relationship_pair_key(u,rel_source_type,rel_source,rel_target_type,rel_target,e.label)) then
   delete from public.contact_relationships where id=e.id;
  else
   update public.contact_relationships set source_id=rel_source,target_id=rel_target,source_type=rel_source_type,target_type=rel_target_type where id=e.id;
   -- Normalization/rejection triggers may suppress an UPDATE. Preserve the
   -- original in the receipt and remove it from the retired source explicitly.
   if exists(select from public.contact_relationships where id=e.id and (source_id=s.id or target_id=s.id)) then
    delete from public.contact_relationships where id=e.id;
   end if;
  end if;
 end loop;
 -- All matching notes, including trashed notes, are handled inside PostgreSQL.
 -- No REST row cap, offset, or client-side page can omit a reference.
 for n in select id,metadata from public.notes where user_id=u and (
  metadata->'matched_people' @> jsonb_build_array(jsonb_build_object('contact_id',s.id))
  or exists(select from jsonb_array_elements(case when jsonb_typeof(metadata->'people')='array' then metadata->'people' else '[]'::jsonb end) x where lower(x#>>'{}')=any(names))) order by id for update loop
  meta:=n.metadata;
  if jsonb_typeof(meta->'people')='array' then
   select coalesce(jsonb_agg(v order by ord),'[]'::jsonb) into arr from (
    select v,min(ord) ord from (
     select case when lower(value#>>'{}')=any(names) then case when dest is null then null else to_jsonb(t.name) end else value end v,ordinality ord
     from jsonb_array_elements(meta->'people') with ordinality) a where v is not null group by v) b;
   meta:=jsonb_set(meta,'{people}',arr);
  end if;
  if jsonb_typeof(meta->'matched_people')='array' then
   select coalesce(jsonb_agg(v order by ord),'[]'::jsonb) into arr from (
    select case when value->>'contact_id'=s.id::text then case when dest is null then null else value||jsonb_build_object('contact_id',dest,'canonical_name',t.name) end else value end v,ordinality ord
    from jsonb_array_elements(meta->'matched_people') with ordinality) a where v is not null;
   meta:=jsonb_set(meta,'{matched_people}',arr);
  end if;
  update public.notes set metadata=meta where id=n.id;
 end loop;
 -- The existing trigger transfers topic rows and writes their lifecycle events.
 update public.contacts set merged_into=coalesce(dest,s.id),merged_at=clock_timestamp(),topic_self_merge_pending=false where id=s.id;
 update public.github_sync_log set sync_status='pending' where user_id=u and entity_type='person' and entity_id in(s.id,dest);
 result_json:=jsonb_build_object('ok',true,'replayed',false,'request_id',p_request_id,'merged',jsonb_build_object('source',s.name,'target',case when dest is null then 'user profile' else t.name end));
 insert into public.contact_merge_receipts(user_id,request_id,payload,result,source_snapshot) values(u,p_request_id,payload_json,result_json,snapshot);
 insert into public.contact_merge_vault_jobs(user_id,request_id,source_contact_id,target_contact_id) values(u,p_request_id,s.id,dest);
 return result_json;
end $function$;
REVOKE ALL ON FUNCTION public.merge_contacts_atomic(uuid, uuid, uuid, boolean) FROM public, anon, service_role;
GRANT EXECUTE ON FUNCTION public.merge_contacts_atomic(uuid, uuid, uuid, boolean) TO authenticated;

-- profile-reconcile folds a contact that is really the account owner into
-- self (plan 2.3). It runs as the service role, so it cannot delete a human's
-- copy: when both copies of one value are preferred it skips that contact and
-- says so, instead of failing on the unique index every two hours (ninth review).
CREATE FUNCTION public.fold_contact_into_self(p_user_id uuid, p_contact_id uuid) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $function$
DECLARE
  e record; k record; sl record; c record;
BEGIN
  PERFORM 1 FROM public.contacts WHERE id = p_contact_id AND user_id = p_user_id FOR UPDATE;
  IF NOT FOUND THEN RETURN 'not_found'; END IF;

  IF EXISTS (
    SELECT 1 FROM public.claims a JOIN public.claims b
      ON b.user_id = a.user_id AND b.subject_type = 'self' AND b.attribute = a.attribute
     AND lower(btrim(b.value)) = lower(btrim(a.value)) AND b.valid_to IS NULL
     WHERE a.user_id = p_user_id AND a.subject_type = 'contact' AND a.subject_id = p_contact_id
       AND a.valid_to IS NULL AND a.rank = 'preferred' AND b.rank = 'preferred') THEN
    RETURN 'skipped_two_preferred';
  END IF;

  -- Identical live values: keep the human's copy, else self's.
  FOR e IN SELECT * FROM public.claims WHERE user_id = p_user_id AND subject_type = 'contact' AND subject_id = p_contact_id AND valid_to IS NULL ORDER BY id FOR UPDATE LOOP
    SELECT * INTO k FROM public.claims WHERE user_id = p_user_id AND subject_type = 'self' AND attribute = e.attribute
       AND lower(btrim(value)) = lower(btrim(e.value)) AND valid_to IS NULL FOR UPDATE;
    IF FOUND THEN
      IF e.rank = 'preferred' THEN DELETE FROM public.claims WHERE id = k.id;
      ELSE DELETE FROM public.claims WHERE id = e.id; END IF;
    END IF;
  END LOOP;
  UPDATE public.claims SET subject_type = 'self', subject_id = NULL
   WHERE user_id = p_user_id AND subject_type = 'contact' AND subject_id = p_contact_id;

  -- Slots: self's wins, pins combined, the most private placement wins.
  FOR e IN SELECT * FROM public.fact_slots WHERE user_id = p_user_id AND subject_type = 'contact' AND subject_id = p_contact_id ORDER BY id FOR UPDATE LOOP
    SELECT * INTO sl FROM public.fact_slots WHERE user_id = p_user_id AND subject_type = 'self' AND attribute = e.attribute FOR UPDATE;
    IF FOUND THEN
      UPDATE public.fact_slots SET is_pinned = sl.is_pinned OR e.is_pinned, show_to_agent = sl.show_to_agent OR e.show_to_agent,
        category_slug = CASE
          WHEN EXISTS (SELECT 1 FROM public.profile_categories WHERE user_id = p_user_id AND contact_id = p_contact_id AND slug = e.category_slug AND visibility_scope = 'private')
           AND NOT EXISTS (SELECT 1 FROM public.profile_categories WHERE user_id = p_user_id AND contact_id IS NULL AND slug = sl.category_slug AND visibility_scope = 'private')
          THEN e.category_slug ELSE sl.category_slug END
       WHERE id = sl.id;
      DELETE FROM public.fact_slots WHERE id = e.id;
    ELSE
      UPDATE public.fact_slots SET subject_type = 'self', subject_id = NULL WHERE id = e.id;
    END IF;
  END LOOP;

  -- Sections: move, or fold into self's, the most private scope winning.
  FOR c IN SELECT * FROM public.profile_categories WHERE user_id = p_user_id AND contact_id = p_contact_id ORDER BY id FOR UPDATE LOOP
    SELECT * INTO k FROM public.profile_categories WHERE user_id = p_user_id AND contact_id IS NULL AND slug = c.slug ORDER BY id LIMIT 1 FOR UPDATE;
    IF NOT FOUND THEN
      UPDATE public.profile_categories SET contact_id = NULL WHERE id = c.id;
    ELSE
      IF c.visibility_scope = 'private' AND coalesce(k.visibility_scope, 'all') <> 'private' THEN
        UPDATE public.profile_categories SET visibility_scope = 'private' WHERE id = k.id;
      END IF;
      DELETE FROM public.profile_categories WHERE id = c.id;
    END IF;
  END LOOP;
  RETURN 'folded';
END;
$function$;
REVOKE ALL ON FUNCTION public.fold_contact_into_self(uuid, uuid) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fold_contact_into_self(uuid, uuid) TO service_role;

-- B6's one-time bag split. A legacy "bag" (several facts in one value) is
-- replaced by its pieces, which keep the bag's origin, quote, source and dates:
-- they are the same legacy fact, only filed singly, so they go in under the
-- migration flag like the switch's own rows. The pieces come from writeFact's
-- splitter (split-legacy-bags). A bag a human typed is never passed here.
-- Service role only; dropped by …_fact_store_cleanup.sql right after B6.
CREATE FUNCTION public.split_legacy_bag(p_user_id uuid, p_claim_id uuid, p_pieces jsonb) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $function$
DECLARE
  bag public.claims;
  piece jsonb;
  added integer := 0;
  n_same integer;
BEGIN
  SELECT * INTO bag FROM public.claims WHERE id = p_claim_id AND user_id = p_user_id AND valid_to IS NULL FOR UPDATE;
  IF NOT FOUND THEN RETURN 0; END IF;
  IF bag.rank = 'preferred' OR bag.origin = 'user_manual' THEN RETURN 0; END IF;
  IF jsonb_typeof(p_pieces) <> 'array' OR jsonb_array_length(p_pieces) < 2 THEN RETURN 0; END IF;

  PERFORM set_config('menerio.fact_migration', 'on', true);
  DELETE FROM public.claims WHERE id = bag.id;

  FOR piece IN SELECT * FROM jsonb_array_elements(p_pieces) LOOP
    SELECT count(*) INTO n_same FROM jsonb_array_elements(p_pieces) x WHERE x->>'attribute' = piece->>'attribute';
    IF NOT EXISTS (SELECT 1 FROM public.fact_slots WHERE user_id = p_user_id AND subject_type = bag.subject_type
                     AND subject_id IS NOT DISTINCT FROM bag.subject_id AND attribute = piece->>'attribute') THEN
      INSERT INTO public.fact_slots (user_id, subject_type, subject_id, attribute, label, category_slug)
      VALUES (p_user_id, bag.subject_type, bag.subject_id, piece->>'attribute', piece->>'label',
              CASE WHEN bag.subject_type = 'entity' THEN NULL ELSE piece->>'category_slug' END);
    END IF;
    -- The bag listed these together, so the attribute holds several.
    IF n_same > 1 THEN
      UPDATE public.fact_slots SET cardinality = 'many'
       WHERE user_id = p_user_id AND subject_type = bag.subject_type AND subject_id IS NOT DISTINCT FROM bag.subject_id
         AND attribute = piece->>'attribute' AND cardinality IS DISTINCT FROM 'many';
    END IF;
    INSERT INTO public.claims (user_id, subject_type, subject_id, attribute, value, valid_from, valid_to, confidence,
                               cardinality, source_type, source_id, evidence_quote, review_by, origin, rank, created_at)
    SELECT p_user_id, bag.subject_type, bag.subject_id, piece->>'attribute', piece->>'value', bag.valid_from, NULL,
           bag.confidence, CASE WHEN n_same > 1 THEN 'many' ELSE bag.cardinality END, bag.source_type, bag.source_id,
           bag.evidence_quote, bag.review_by, bag.origin, 'normal', bag.created_at
     WHERE NOT EXISTS (SELECT 1 FROM public.claims c WHERE c.user_id = p_user_id AND c.subject_type = bag.subject_type
                         AND c.subject_id IS NOT DISTINCT FROM bag.subject_id AND c.attribute = piece->>'attribute'
                         AND lower(btrim(c.value)) = lower(btrim(piece->>'value')) AND c.valid_to IS NULL);
    IF FOUND THEN added := added + 1; END IF;
  END LOOP;
  PERFORM set_config('menerio.fact_migration', 'off', true);
  RETURN added;
END;
$function$;
REVOKE ALL ON FUNCTION public.split_legacy_bag(uuid, uuid, jsonb) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.split_legacy_bag(uuid, uuid, jsonb) TO service_role;

-- 12. Review queue: items that point at an entry now point at its claim. Items
-- whose entry was folded into another claim are not revertible (a revert would
-- delete a different, possibly human, fact). Items whose entry no longer exists
-- stay as they are, marked not revertible. The previous target and status are
-- kept in the payload for the rollback.
WITH repointed AS (
  UPDATE public.review_queue r
     SET target_entity_type = 'claim', target_entity_id = e.derived_from_claim_id,
         payload = r.payload || jsonb_build_object('fact_store_switch', jsonb_build_object(
           'entry_id', r.target_entity_id,
           'revertible', NOT EXISTS (SELECT 1 FROM _fs_folded_entries f WHERE f.entry_id = e.id)))
    FROM public.profile_entries_archive e
   WHERE r.target_entity_type = 'profile_entry' AND e.id = r.target_entity_id
  RETURNING 1)
INSERT INTO fact_switch_report SELECT 'step12_review_items_repointed', count(*) FROM repointed;

WITH missing AS (
  UPDATE public.review_queue r
     SET payload = r.payload || jsonb_build_object('fact_store_switch', jsonb_build_object('entry_missing', true, 'revertible', false))
   WHERE r.target_entity_type = 'profile_entry' AND r.target_entity_id IS NOT NULL
  RETURNING 1)
INSERT INTO fact_switch_report SELECT 'step12_review_items_entry_missing', count(*) FROM missing;

WITH superseded AS (
  UPDATE public.review_queue r
     SET status = 'superseded',
         payload = r.payload || jsonb_build_object('fact_store_switch', jsonb_build_object('prior_status', r.status))
   WHERE r.suggestion_type = 'normalize_profile_entry' AND r.status IN ('pending', 'pending_review')
  RETURNING 1)
INSERT INTO fact_switch_report SELECT 'step12_normalize_superseded', count(*) FROM superseded;

-- 13. Assertions. Each RAISEs, which undoes the whole transaction.
DO $$
DECLARE
  cnt bigint;
  expected bigint;
BEGIN
  SELECT count(*) INTO cnt FROM public.profile_entries_archive e
   WHERE e.derived_from_claim_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.claims c WHERE c.id = e.derived_from_claim_id);
  IF cnt > 0 THEN RAISE EXCEPTION 'fact_switch_assert: % archived entries have no claim', cnt; END IF;

  SELECT (SELECT n FROM fact_switch_report WHERE step = 'before_claims')
       - (SELECT n FROM fact_switch_report WHERE step = 'step4_folded_duplicates')
       - (SELECT n FROM fact_switch_report WHERE step = 'step7_unshown_dropped')
       + coalesce((SELECT sum(r.n) FROM fact_switch_report r WHERE r.step LIKE 'step5_inserted_%'), 0)
    INTO expected;
  SELECT count(*) INTO cnt FROM public.claims;
  IF cnt <> expected THEN RAISE EXCEPTION 'fact_switch_assert: % claims, expected %', cnt, expected; END IF;

  SELECT count(*) INTO cnt FROM public.profile_entries_archive e
   JOIN _fs_entry x ON x.id = e.id
   WHERE NOT EXISTS (
     SELECT 1 FROM public.profile_facts f
      WHERE f.claim_id = e.derived_from_claim_id
        AND lower(btrim(f.value)) = lower(btrim(e.value))
        AND f.subject_type = CASE WHEN e.contact_id IS NULL THEN 'self' ELSE 'contact' END
        AND f.subject_id IS NOT DISTINCT FROM e.contact_id
        AND (f.is_current OR x.kind = 'closed'));
  IF cnt > 0 THEN RAISE EXCEPTION 'fact_switch_assert: % entries are not shown with their words, subject and currency', cnt; END IF;

  SELECT count(*) INTO cnt FROM public.profile_entries_archive e
   JOIN _fs_private_entries p ON p.id = e.id
   WHERE NOT EXISTS (SELECT 1 FROM public.profile_facts f WHERE f.claim_id = e.derived_from_claim_id AND f.visibility_scope = 'private')
      OR EXISTS (SELECT 1 FROM public.agent_facts a WHERE a.claim_id = e.derived_from_claim_id);
  IF cnt > 0 THEN RAISE EXCEPTION 'fact_switch_assert: % private-section entries are not private', cnt; END IF;

  SELECT count(*) INTO cnt FROM public.claims WHERE origin = 'user_manual' AND rank <> 'preferred';
  IF cnt > 0 THEN RAISE EXCEPTION 'fact_switch_assert: % user_manual claims are not preferred', cnt; END IF;

  SELECT count(*) INTO cnt FROM public.claims c WHERE c.subject_type <> 'entity' AND NOT EXISTS (
    SELECT 1 FROM public.fact_slots s WHERE s.user_id = c.user_id AND s.subject_type = c.subject_type
       AND s.subject_id IS NOT DISTINCT FROM c.subject_id AND s.attribute = c.attribute);
  IF cnt > 0 THEN RAISE EXCEPTION 'fact_switch_assert: % claims have no slot', cnt; END IF;

  SELECT count(*) INTO cnt FROM public.profile_facts WHERE has_conflict AND is_current;
  IF cnt > 0 THEN RAISE EXCEPTION 'fact_switch_assert: % facts still show two answers', cnt; END IF;

  SELECT count(*) INTO cnt FROM public.world_claims WHERE source_table = 'profile_entry';
  IF cnt > 0 THEN RAISE EXCEPTION 'fact_switch_assert: world_claims still has profile_entry rows'; END IF;

  SELECT count(*) INTO cnt FROM (
    SELECT user_id FROM public.claims GROUP BY user_id
    EXCEPT ALL
    SELECT user_id FROM public.profile_facts GROUP BY user_id) x;
  SELECT cnt + count(*) INTO cnt FROM (
    SELECT c.user_id, count(*) FROM public.claims c GROUP BY 1
    EXCEPT
    SELECT f.user_id, count(*) FROM public.profile_facts f GROUP BY 1) x;
  IF cnt > 0 THEN RAISE EXCEPTION 'fact_switch_assert: profile_facts does not show each claim exactly once'; END IF;

  SELECT count(*) INTO cnt FROM (
    SELECT b.kind, b.n AS before_n,
           coalesce((SELECT count(*) FROM public.review_queue r WHERE r.suggestion_type = b.kind AND r.status IN ('pending','pending_review')), 0)
         + coalesce((SELECT count(*) FROM public.review_queue r WHERE r.suggestion_type = b.kind AND r.status = 'superseded'
                       AND r.payload->'fact_store_switch' ? 'prior_status'), 0) AS after_n
      FROM _fs_before b WHERE b.what = 'pending_review') x
   WHERE before_n <> after_n;
  IF cnt > 0 THEN RAISE EXCEPTION 'fact_switch_assert: pending review items changed for % types', cnt; END IF;

  SELECT count(*) INTO cnt FROM pg_proc p
   WHERE p.pronamespace = 'public'::regnamespace AND p.prosrc ~ 'profile_entries\M'
     AND p.proname NOT IN ('world_preferred_wins', 'world_preferred_survives_delete');
  IF cnt > 0 THEN RAISE EXCEPTION 'fact_switch_assert: % public functions still name profile_entries', cnt; END IF;
END $$;

INSERT INTO fact_switch_report VALUES
  ('after_claims', (SELECT count(*) FROM public.claims)),
  ('after_slots', (SELECT count(*) FROM public.fact_slots)),
  ('after_two_answers_slots', (SELECT count(DISTINCT slot_id) FROM public.profile_facts WHERE has_conflict AND is_current)),
  ('after_agent_facts', (SELECT count(*) FROM public.agent_facts)),
  ('after_world_claims_claim_rows', (SELECT count(*) FROM public.world_claims WHERE source_table = 'claim'));
