# Yes — there is a design that practically guarantees it

The previous plan was wrong in one specific way: it used the LLM only as a *last resort*, on a single incoming label, without ever showing it the rest of the profile. That is why "Age moved out: 16" and "Life events: moved out at 16" survived — the LLM was never shown both.

The fix is to invert it: **the LLM reads the whole profile, every time, and the profile is not considered valid until the LLM says there are zero duplicates.**

## The concept: whole-profile audit as a gate

1. **Any change to a person's profile schedules an audit.** New fact from a note, manual edit, review-queue keep, import — all of them mark the profile `dirty`.
2. **The auditor sends the entire profile in one prompt** — every category, label and value for that person, numbered. Not the incoming row. The whole thing.
3. **It asks exactly one question:** which entries state the same underlying fact, and what is the single correct entry that replaces them? It must answer as structured JSON: groups of row IDs plus the one merged label and value per group, and a short reason.
4. **The application is deterministic.** Code applies the merge (keep one row, delete the others, log the originals so it is reversible). The LLM never writes to the database and never invents a label outside the registry.
5. **Then it re-audits.** The merged profile goes back through the same prompt. The profile is only marked `clean` when the audit returns an empty duplicate list. If two rounds still disagree, the profile is flagged for me/you, not silently left dirty.
6. **Nothing renders as final while dirty.** The profile page shows a small "tidying up" state until the audit passes, so you never look at an un-audited profile.

Steps 1–5 of the old plan (normalization, trigram matching, value collapse) stay, but only as a cheap pre-filter that reduces how much the auditor has to fix. They are no longer the guarantee. The guarantee is the audit gate.

## Why this actually holds

- The LLM is always shown the two entries **side by side**, which is the case you correctly said it can solve.
- The check is on **facts**, not labels, so different wordings of the same fact are caught.
- It is a **gate, not a suggestion** — a profile cannot reach the "clean" state while a duplicate is detectable.
- It **converges**: re-auditing after each merge catches duplicates that only become visible once earlier ones collapse.
- The user is **never asked to judge duplicates**. The review queue keeps only genuinely new concepts.

## What you should expect it to cost

One cheap model call per changed profile (plus one confirmation round), not per note-fact. Audits are debounced, so ten facts arriving from one note produce one audit. Backfill across all existing profiles runs in the background.

## Cross-checking that it works

- A fixture set of the real failures you have reported ("Age moved out"/"Life events", "Second job"/"Additional work"/"Other occupation", the Nickname/Aka/Alternative-name cluster, Selby/Zelbel) is run against the auditor as a test. Any regression fails the build.
- After the backfill, every profile is queried for remaining duplicate clusters and the count must be zero before I report done.
- I verify against the rendered profile pages, not just the tables.

## Technical notes

- New table `profile_audit_runs` (contact/user scope, status `dirty|running|clean|conflict`, rounds, findings JSON) and a `profile_audit_log` of applied merges for rollback.
- Trigger on `profile_entries` marks scope dirty; a debounced worker (`profile-audit` edge function, background via `EdgeRuntime.waitUntil`) picks up dirty scopes.
- Prompt input: all rows for the scope as `{id, category, label, value}`. Output schema: `{groups:[{ids:[], label, value, reason}], none:boolean}`. Structured output enforced; any label outside `profile_fields` is rejected and the group is dropped, not written.
- Merge applier is pure SQL in a security-definer function so the same path is used by the worker, the review-queue keep path, and manual edits.
- Existing trigram/token resolver stays as pre-filter to keep audit input small; `profile_dedup_sweep` becomes the pre-pass of the backfill.
- Backfill: iterate all contacts with >1 entry, batched, resumable, with progress in `profile_audit_runs`.
