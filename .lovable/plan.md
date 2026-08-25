# Make bulk “Keep” finish the Review Queue

## Confirmed cause

The latest bulk job processed 31 items: 30 left the queue and one stayed pending.
The remaining suggestion is **“Favorite animals: dragons”**. That profile already has:

- a `Favorite animals` field, and
- a value containing `dragons (mythical)`.

The bulk handler nevertheless tries to insert the same profile-field definition again with `.single()`. PostgreSQL absorbs/rejects that duplicate, PostgREST returns `PGRST116` (“0 rows”), and the handler incorrectly classifies the already-covered suggestion as an application failure. The final reconciliation then leaves it pending and the UI repeats the same generic message twice.

## Intended behavior

“Keep” is a final decision. Every selected queue item must leave the active queue:

1. **Applied** — the requested data was written.
2. **Already satisfied** — equivalent data already existed, so no duplicate is created.
3. **Skipped** — the suggestion is invalid or cannot safely be represented; it is archived with the specific reason.

An individual item must not remain pending after a completed Keep job. A job-level infrastructure failure may stop the whole job and report an error, but it must not masquerade as a successful completed job.

## Implementation

### 1. Make profile-field Keep idempotent

In `supabase/functions/review-queue-bulk/index.ts`:

- For `unknown_profile_field`, look up and reuse an existing user/system field with the same canonical category and label before attempting an insert.
- Check every database error instead of relying only on returned data.
- Before inserting the profile value, detect whether the same fact—or a fact that already contains it—exists for that person.
- Treat a duplicate-prevention trigger absorbing the write as **already satisfied**, not failed.
- Mark the review row `kept` in both the newly-applied and already-satisfied cases.

This exact “dragons” item should therefore resolve as already present, without creating another field or duplicate fact.

### 2. Give every Keep attempt a terminal outcome

In the same bulk worker:

- Make each suggestion handler return a structured result: `applied`, `already_satisfied`, or `skipped`, with a concise reason when relevant.
- If a deterministic validation/data-integrity condition prevents application, mark the queue row `removed`, set `reviewed_at`, and record the reason in its payload instead of leaving it pending.
- Reserve a job-level `error` for unexpected infrastructure failures. Do not finish with `status: done` while target rows are still active.
- Reconcile at the end and terminally archive any deterministic stragglers, so a completed Keep job guarantees an empty processed scope.

### 3. Report what actually happened

Use the existing bulk-job counters/error field without adding a new table:

- Count both `applied` and `already_satisfied` as successfully kept.
- Summarize skipped items separately in `last_error`, using useful reasons rather than “remain in the queue.”
- Update `src/pages/ReviewQueue.tsx` toast wording to examples such as:
  - `31 changes kept`
  - `30 changes applied · 1 was already in the profile`
  - `30 changes applied · 1 skipped — missing required profile data`
- Never say an item “stays in the queue” after Keep completes.

### 4. Verify the real case and regressions

- Re-run Keep for the current “Favorite animals: dragons” row.
- Confirm it leaves the active queue, no duplicate `profile_fields` row is created, and no duplicate profile fact is added.
- Confirm the job ends with `failed = 0` and an honest applied/already-satisfied summary.
- Test an invalid deterministic suggestion and confirm it is archived as skipped with a reason.
- Test an unexpected backend failure and confirm the job reports `error` rather than falsely reporting completion.
