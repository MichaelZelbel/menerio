# Deferred note AI: rollout and recovery

## Status and approval boundary

Michael explicitly requested committing, pushing to main and deploying this fix live on September 7, 2026. This authorizes the release and its verification. It does not authorize manual allowance adjustments. No savings have been measured. Synthetic fixture results are not provider answers or evidence of actual credit savings.

Production project identified by the plan and read-only inspection: `tjeapelvjlmbxafsmjef`. The inspected database runs PostgreSQL 17.6. A distinct hosted staging project has not been verified; do not assume the local PostgreSQL fixture is a full Supabase staging deployment.

## Defaults being introduced

- Save immediately through the existing editor/local database paths.
- Wait two minutes after the last relevant input change.
- Space automatic starts for each note/pipeline by ten minutes.
- After fifteen minutes pending during continuous editing, make the latest snapshot eligible, subject to spacing and available capacity.
- Manual requests get priority, not permission to repeat a completed fingerprint or bypass a lease/balance check.
- At most three attempts for a revision. Known no-credit refusals park for a cheap one-hour probe or an explicit manual wake. Uncertain paid outcomes retain a diagnostic fence rather than buying another call immediately.
- One scheduler tick per minute, at most ten admissions and two concurrent executions per invocation. Default admission window is 25 seconds; execution HTTP timeout is 110 seconds. Queue leases are five minutes.
- Worker settings initially have `enabled = false` and `user_ids = '{}'`. Empty scope means nobody; `NULL` scope means all accounts.

These timing values are implementation defaults, not measured optimums. The scheduled worker can only meet freshness targets when actual provider latency and backlog permit it.

## 1. Recheck and preserve the live baseline

After approval, before any deployment:

1. Record deployed versions and bodies for every function listed below, installed migration versions, the existing scheduler command, worker settings if present, and the currently published frontend version. Preserve these as private rollback artifacts, without keys or note bodies.
2. Query a fresh anonymized usage baseline by account, pipeline and active editing workload. Record queue age and failures if available. Inspect both live `deduct_ai_tokens` overloads again; their financial behavior must still match the baseline inspected for this change.
3. Compare local pending migrations with production. Stop if any unrelated migration would be applied. A generic `db push` is not permission to apply unrelated changes.
4. Confirm staging/test project identity and an explicitly approved canary account. Do not infer either from the production project reference.

## 2. Apply only the approved additive migrations

Apply in timestamp order, to staging/test first and then to production only after staging passes:

1. `20260907103000_llm_usage_exact_attribution.sql`
2. `20260907120000_note_ai_jobs.sql`
3. `20260907123000_profile_normalization_inputs.sql`
4. `20260907124000_wiki_note_ai_apply.sql`
5. `20260907125000_note_ai_analysis_effects.sql`
6. `20260907130000_schedule_note_ai_jobs.sql`
7. `20260907131000_note_ai_capture_enrollment.sql`

Verify the actual installed definitions and grants, not just a successful migration command. The new scheduler is installed disabled. There is no archive-wide Lexicon enrollment or credit adjustment.

The final migration adds the authenticated `capture_note_with_lexicon` transaction. New online captures and eligible offline uploads save and enroll together. ID-only receipts prevent a lost-response retry from overwriting a newer edit or resurrecting a deleted capture. This migration must exist before the new frontend is published.

## 3. Deploy the server compatibility paths

Deploy `process-note`, `wiki-ingest`, `sweep-note-processing`, `analyze-media`, `drain-note-ai-jobs`, `normalize-profile`, `admin-normalize` and the adjusted `wiki-restructure` billing path. The billing path retains user-scoped page access while using a separate service client for the service-only billing routine. Normalization entry points must reach the full-input check when prompt/schema inputs change and forward explicit manual requests without forcing every internal pass. Scheduled normalization remains deterministic-only and queue-scoped. Older browser requests must return a queued response and must not directly buy analysis. A JSON `execute`, `cron` or administrator flag is not authentication. Test forged requests and cross-account identifiers before activation.

Shared modules are bundled separately into each Edge Function. Updating the repository does not update the deployed consumers. The following complete affected consumer list was derived from local relative imports, including indirect shared imports:

```text
admin-llm-config
admin-normalize
ai-moderate-content
analyze-media
backfill-embeddings
backfill-moment-profile-extraction
backfill-person-documents
classify-profile-fact
collection-chat
conversation-chat
daily-digest
draft-event
drain-note-ai-jobs
embed-document
enrich-person-from-lexicon
extract-event
extract-moment-profile
find-connections
gdrive-sync
generate-group-briefing
generate-profile-suggestions
generate_collection_schema
ingest-thought
menerio-mcp
normalize-profile
note-chat
process-note
profile-audit
profile-lint
profile-reconcile
quick-capture
review-queue-bulk
search-documents
search-notes-semantic
slack-capture
suggest-connections
suggest-group-members
suggest-group-next-step
sweep-note-processing
weekly-review
wiki-cleanup
wiki-ingest
wiki-lint
wiki-restructure
```

Deploy those consumers from the same reviewed source revision, respecting each function's existing JWT configuration. Do not redeploy unrelated functions or enable execution merely because a deployment returned success. Read back deployed versions/bodies and verify the worker's cron-secret authorization.

## 4. Activate only the approved canary

With a verified account UUID, set both fields explicitly:

```sql
BEGIN;
UPDATE public.note_ai_worker_settings
SET enabled = true, user_ids = ARRAY['<approved-account-uuid>'::uuid]
WHERE id = true;
SELECT cron.alter_job(jobid, active := true)
FROM cron.job WHERE jobname = 'drain-note-ai-jobs';
COMMIT;
```

The placeholder must be replaced with the approved account, never an inferred account. Read back both the exact settings row and the scheduler's active flag. Settings alone do not activate the initially inactive schedule. Exercise the actual app and old request shape with synthetic notes: twenty-second edits, title-only edits, tab closure, two tabs, offline creation/reconnection, attachment completion, an edit during execution, repeated unchanged requests, and a no-action Lexicon result. Confirm complete results, search, extraction, grounding and protected sections, not merely accepted responses.

Inspect:

- `net._http_response`, including status, timeout and error; scheduler SQL success alone is insufficient.
- `note_ai_jobs`, `note_ai_stage_results`, `note_ai_completions`, and normalization lease/input rows, scoped to the test account.
- New `llm_usage_events` attribution for exact call site, note, job, fingerprint and stage; compare actual allowance movement with the ledger.
- Any `uncertain`, `attempt_limit`, no-credit or stale-result outcomes before releasing more accounts.

The approved live canary is the first real provider-quality and provider/ledger verification. Local fixtures cannot replace it.

## 5. Expand, then publish the frontend last

Only after the canary passes and expansion is approved:

```sql
UPDATE public.note_ai_worker_settings
SET enabled = true, user_ids = NULL
WHERE id = true;
```

Read back the settings and verify actual finished jobs across accounts. Publish the reviewed frontend through the established frontend release process last. A git push alone does not migrate the database, deploy Edge Functions or publish the app.

Compare the next 24 and 48 hours using comparable active editing workloads, split by pipeline. Report actual calls, tokens, no-action completions, queue age, failures and output freshness. Do not turn a lower raw daily total into a claimed saving or refund.

## Recovery without restoring the old spending loop

First pause new automatic claims:

```sql
BEGIN;
UPDATE public.note_ai_worker_settings
SET enabled = false, user_ids = '{}'
WHERE id = true;
SELECT cron.alter_job(jobid, active := false)
FROM cron.job WHERE jobname = 'drain-note-ai-jobs';
COMMIT;
```

Read back the settings. An already running lease may still finish; this setting does not cancel a provider request already in flight. Preserve saved notes, queued work, staged paid results and usage records. Do not reset balances, erase jobs or automatically restore the old ten/twelve-second execution paths.

Keep the authenticated enqueue compatibility endpoints. If manual execution is needed during recovery, retain the scoped worker for only an approved account and allow it to claim the manual request normally. Repair or roll forward the affected application code from the preserved artifacts, then repeat canary verification before broad activation.

## Reproducing local checks

Run from the repository root:

```sh
npm test
npm run build
npm run lint
node scripts/test-note-ai-worker-load.mjs
```

The load script sends only synthetic requests to a loopback HTTP server. It exercises both short replies and actual 70-second delayed replies with the real worker admission code. It does not estimate real provider throughput or savings.

SQL tests deliberately use separate disposable databases. Supply connection values privately; never put them in this document, shell history or test output. Fixtures recreate synthetic schema and must never point at an application database. Use PostgreSQL 17.6 for the production-version match. These fixtures exercise real transactions and concurrent sessions, but do not reproduce the entire hosted Supabase platform, vector indexes or the real cron extension.

| Runner | Required environment / database |
| --- | --- |
| `node scripts/test-note-ai-jobs.mjs` | `NOTE_AI_TEST_DATABASE_URL`: local `note_ai_disposable`; `NOTE_AI_TEST_ALLOW_DISPOSABLE=1`; `NOTE_AI_TEST_APPLY_MIGRATION=1` for a fresh fixture |
| `node scripts/test-wiki-ingest-jobs.mjs` | `NOTE_AI_TEST_DATABASE_URL`: local `wiki_disposable`; `NOTE_AI_TEST_ALLOW_DISPOSABLE=1`; `NOTE_AI_TEST_APPLY_QUEUE=1` for a fresh fixture |
| `node scripts/test-note-ai-analysis.mjs` | `NOTE_AI_ANALYSIS_TEST_DATABASE_URL`: local `analysis_disposable`; `NOTE_AI_TEST_ALLOW_DISPOSABLE=1` |
| `node scripts/test-note-ai-enrollment.mjs` | `NOTE_AI_TEST_DATABASE_URL`: local `enrollment_disposable`, PostgreSQL 17; runner owns this fixture database |
| `node scripts/test-note-ai-worker.mjs` | `NOTE_AI_TEST_DATABASE_URL`: local `worker_disposable`; `NOTE_AI_TEST_ALLOW_DISPOSABLE=1`; cron API is an explicit SQL fixture |
| Attribution Vitest file | `MENERIO_USAGE_TEST_DATABASE_URL`: local `usage_disposable` |
| Normalization Vitest file | `NORMALIZATION_TEST_DATABASE_URL`: local `normalization_disposable` |

For the last two rows, run `npx vitest run supabase/functions/_shared/__tests__/llm-usage-attribution.test.ts supabase/functions/_shared/__tests__/profile-normalization-spend.test.ts`. Without those optional URLs, the SQL cases are deliberately skipped by ordinary unit tests. The local PostgreSQL fixture needs the usual `anon`, `authenticated` and `service_role` roles and public-schema usage grants; do not confuse missing fixture setup with production permission behavior.
