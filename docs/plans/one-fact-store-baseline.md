# One fact store: baseline counts

Counts only (plan rule 5.1). Queries are section 5.2 A1 of `docs/plans/one-fact-store.md`, run read-only through `scripts/rehearsal/prod-read.sh` on 2026-09-28.

## A1 baseline (2026-09-28)

| Query | Result |
|---|---|
| B1 entries | self linked 86, self unlinked 19, contact linked 174, contact unlinked 3 (total 282) |
| B2 claims | 519 total: self live 301 (unverified 154, review_queue 67, ai_note 53, menerio 24, user_manual 3), self closed 6; contact live 204 (unverified 147, ai_note 28, review_queue 15, user_manual 12, menerio 2), contact closed 8; entity 0 |
| B3 linked entries whose words differ | 13 (11 on `cardinality='one'`, 2 on `'many'`); 0 with another subject |
| B4 entries linked to a closed claim | 3 |
| B5 claims shown by more than one entry | 0 |
| B6 live claims shown by no entry | 248 (self 218, contact 30); 35 of them repeat a shown value |
| B7 entries of hidden or sensitive contacts | 0 |
| B8 duplicate live value groups | 96 (192 claims, 96 surplus) |
| B9 `world_claims` by arm | claim 519, contact_relationship 15, profile_entry 22 |
| B9 open review items | add_profile_entry 1,115 pending_review + 134 auto_applied_unreviewed; unknown_profile_field 4,795 (+7 targeting self); normalize_profile_entry 479; add_contact 295; add_relationship 59 + 8; add_alias 42 + 4; relationship conflicts 17; add_moment 9 + 2; merge_duplicate_person 3 |
| B9 items targeting `profile_entry`, by target | every pending one has a NULL target; about 250 point at an existing entry; about 1,500 point at a deleted one |
| B10 relationships / entries in private sections / orphaned contact claims | 15 / 2 / 0 |
| B11 legacy rows the quality guard would refuse | 0 |
| B12 owners | `claims` postgres, `profile_entries` postgres |
| B13 longest value (bytes) | claims 448, profile_entries 1,396 |
| B14 labels in both a private and a public section | 0 |
| B15 rows Godspeed would pull after go-live | 534 |
| B16 RLS on / policies | ai_suggestion_suppressions on/1, claims on/4, profile_categories on/2, profile_entries on/2, review_queue on/1 |
| `claims_origin_known` violations | 0 |
| Claims with `valid_from` / `valid_to` set | 509 / 14 |
| Distinct entry labels / claim attributes / `attribute_rules` rows | 207 / 318 / 38 |
| Accounts with claims | 3 |

## Predicted switch counts (read-only, 2026-09-28)

From `scripts/rehearsal/predict-switch-counts.sql` (branch `claude/wonderful-keller-sashcq`). Live at the time: 273 entries, 519 claims, 496 live.

| Step | Predicted |
|---|---|
| claims after | 454 |
| step 3 made preferred | 17 |
| step 4 folded duplicates | 96 |
| step 5 entries equal / differs / closed / unlinked | 238 / 12 / 1 / 22 |
| step 5 new claims / folded into existing | 31 / 3 |
| step 6 placed private by "most private wins" | 0 |
| step 7 unshown claims kept (drop list empty) | 159 |
| attributes with two answers after the switch | 25 |
| entries in private sections | 2 |

## A6 dress rehearsal, real counts (2026-09-28)

`dress-rehearsal-sql.sh` run on production through `prod-apply.sh`. It ended in the expected `FACT_STORE_REHEARSAL_DONE` error, which undid everything; `fact_slots` does not exist afterwards. Before it: the inputs migration `20260929090000` applied and recorded, `build-fact-label-map` deployed and run (516 map rows, 0 missing labels, 0 missing attributes). Drop list `fact_unshown_drop` empty, so every unshown claim is kept.

| Step | Predicted | Real |
|---|---|---|
| entries / claims before | 273 / 519 | 273 / 519 |
| live claims shown by no entry (B6) | 248 | 248 |
| claims after | 454 | 454 |
| step 3 made preferred | 17 | 17 |
| step 4 folded duplicates | 96 | 96 |
| step 5 entries equal / differs / closed / unlinked | 238 / 12 / 1 / 22 | 238 / 12 / 1 / 22 |
| step 5 new claims / folded into existing | 31 / 3 | 31 (11 differs + 20 unlinked) / 3 |
| step 6 placed private by "most private wins" | 0 | 0 |
| step 6 slots from entries | | 268 |
| step 7 unshown claims kept / dropped | 159 / 0 | 159 / 0 |
| step 7 slots added / of them in a private section | | 138 / 1 |
| slots after / with two answers | / 25 | 406 / 25 |
| agent facts after | | 451 |
| step 12 normalize items superseded | 479 (B9) | 479 |
| step 12 review items repointed / entry missing | about 250 / about 1,500 (B9) | 234 / 1,654 |
| `world_claims` claim rows after | | 451 (519 before) |
| Godspeed removals / additions | | 101 / 11 |
| many-valued entries whose words differ (listed for Michael) | 2 (B3) | 2 |
| live claims holding a list value (legacy bags) | | 73 |
| `claims_origin_known` violations | 0 | 0 |
| B15 rows Godspeed pulls after go-live (claims + relationships) | | 469 |
