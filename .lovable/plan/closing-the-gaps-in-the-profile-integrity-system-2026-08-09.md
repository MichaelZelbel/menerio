# Closing the gaps in the Profile Integrity System

Layers 1, 2 and part of 4 shipped: the canonical vocabulary, the shared write gate used by every writer, the database triggers, and the relationship rendering rewrite. Four pieces of the approved plan were not built. This closes them.

## Gap 1 — No one-time cleanup of the existing mess

The gate only stops *new* junk. The 23 items already on your profile (mirrored edges, `subject of notes`, the self-referential "financial advisor", `Gym: Gym`, the four duplicate "Interests" labels) are still stored, because `profile-lint` was never run in repair mode over the whole account.

Fix: a one-shot full-account repair run, reported afterwards with an itemised list of what was removed and why. Nothing is deleted that the gate itself would accept, and Xihui/Yumei stay untouched.

## Gap 2 — The reconciler never runs by itself

`profile-lint` exists as an endpoint but nothing calls it: no schedule, no UI entry point.

Fix:
- Nightly `pg_cron` job invoking `profile-lint` per user in repair mode, running in the background so it cannot time out.
- A manual "Check profile health" action on a person page that lints just that person.

## Gap 3 — Ambiguous cases are silently dropped instead of queued

Today `profile-lint` can only delete or report. The plan required the cases needing your judgement to reach the Review Queue: duplicate people (Brigitte/Mum, the three Xihuis) and genuine evidence contradictions.

Fix: add the two Review Queue item types the plan named — `merge_duplicate_person` (one-click merge via the existing merge path) and `resolve_relationship_conflict` — with before/after rendering and rollback, matching how `normalize_profile_entry` already works. Multiple partners are still never queued as a conflict.

## Gap 4 — No profile health indicator, no fixture tests

Fix:
- A small health chip on each person showing outstanding violations, linking to the queue.
- A mirror test asserting the frontend and edge copies of `profile-integrity.ts` share a byte-identical core — the frontend copy has already drifted (its fact gate skips the label-folding the edge copy does), which is exactly the drift that test prevents.
- Fixture tests built from your real rows asserting the expected end state, and a lint assertion that must return zero violations.

## Technical notes

- `src/lib/profile-integrity.ts` and `supabase/functions/_shared/profile-integrity.ts` get a shared, marker-delimited core so the mirror test can compare them; the frontend gains the same label folding.
- `profile-lint` gains: classification into `auto_repair` vs `needs_review`, insertion into `review_queue`, a `scope: "all_users"` mode for cron, and `EdgeRuntime.waitUntil` background execution.
- New migration: nightly cron schedule and a `profile_lint_violations` view for the health chip.
- `ReviewQueue.tsx`: register the two new types with apply/rollback handlers.
- Rollout: mirror + tests → lint classification/queueing → cron + view → UI chip → one-time cleanup run, reporting the violation count after each step.
