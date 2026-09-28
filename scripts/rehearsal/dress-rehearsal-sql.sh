#!/bin/bash
# Prints the A6 dress rehearsal as ONE SQL statement (docs/plans/one-fact-store.md, A6).
#
# A single DO block runs the schema migration and the switch migration, adds the
# rehearsal-only counts, and then always RAISEs with the counts as its message.
# One statement is atomic whatever transaction mode the caller uses, so the
# RAISE undoes everything: nothing it did survives, on any path. The message
# holds numbers only (plan rule 5.1).
#
# Usage: bash scripts/rehearsal/dress-rehearsal-sql.sh > <scratch>/rehearsal.sql
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
SCHEMA="$ROOT/supabase/migrations/20260929090100_fact_store_schema.sql"
SWITCH="$ROOT/supabase/migrations/20260929090200_fact_store_switch.sql"
for tag in fs_rehearsal fs_schema fs_switch; do
  if grep -q "\$$tag\\$" "$SCHEMA" "$SWITCH"; then echo "dollar tag $tag occurs in a migration" >&2; exit 1; fi
done
cat <<SQL
DO \$fs_rehearsal\$
DECLARE
  report jsonb;
BEGIN
  CREATE TEMP TABLE _fs_old_world ON COMMIT DROP AS
    SELECT id FROM public.world_claims WHERE source_table <> 'contact_relationship';
  EXECUTE \$fs_schema\$
$(cat "$SCHEMA")
\$fs_schema\$;
  EXECUTE \$fs_switch\$
$(cat "$SWITCH")
\$fs_switch\$;
  INSERT INTO fact_switch_report VALUES
    ('rehearsal_godspeed_removals', (SELECT count(*) FROM _fs_old_world o
                                      WHERE NOT EXISTS (SELECT 1 FROM public.world_claims w WHERE w.id = o.id))),
    ('rehearsal_godspeed_additions', (SELECT count(*) FROM public.world_claims w
                                      WHERE w.source_table = 'claim' AND NOT EXISTS (SELECT 1 FROM _fs_old_world o WHERE o.id = w.id))),
    ('rehearsal_origin_known_violations', (SELECT count(*) FROM public.claims WHERE NOT (origin IN
       ('user_manual','unverified','menerio','ai_note','ai_moment','ai_lexicon','review_queue','import','mcp','api','normalizer')))),
    ('rehearsal_list_values_on_claims', (SELECT count(*) FROM public.claims WHERE valid_to IS NULL AND value ~ '[,;]')),
    ('rehearsal_many_valued_differs', (SELECT count(*) FROM public.claims c JOIN public.profile_entries_archive e ON e.id = c.id
                                      WHERE c.cardinality = 'many' AND e.derived_from_claim_id = c.id
                                        AND EXISTS (SELECT 1 FROM public.claims o WHERE o.user_id = c.user_id AND o.subject_type = c.subject_type
                                                     AND o.subject_id IS NOT DISTINCT FROM c.subject_id AND o.attribute = c.attribute
                                                     AND o.id <> c.id AND o.valid_to IS NULL)));
  SELECT jsonb_object_agg(step, n ORDER BY step) INTO report FROM fact_switch_report;
  RAISE EXCEPTION 'FACT_STORE_REHEARSAL_DONE %', report;
END
\$fs_rehearsal\$;
SQL
