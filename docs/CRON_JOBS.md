# Scheduled jobs and how they authenticate

Every timer in Menerio is a pg_cron job in the live database that calls an edge
function over HTTP. This file is the inventory, the auth model, and the runbook.
The `cron.job` table in the database is the source of truth for what actually
runs; this file was last reconciled against it on 2026-08-26.

## The auth model

A scheduled call must prove it comes from the scheduler, not from someone who
knows the URL. The proof is a shared secret:

- The secret lives in one place: the `internal.cron_secret` table (single row,
  generated inside the database, never committed anywhere).
- Jobs call `internal.call_edge(fn_name, payload)`, which attaches the secret
  as the `x-cron-key` header on every run. It also sends the public anon key as
  `apikey` and `Authorization` so the call passes the platform gateway
  regardless of the function's `verify_jwt` setting.
- Functions verify the header through `supabase/functions/_shared/cron-auth.ts`,
  which reads the expected value via the service-role-only RPC
  `public.get_cron_secret()` and fails closed on any error.
- Body markers such as `{"cron": "profile-audit"}` still exist, but they are
  routing information only. They grant nothing.

`scripts/check-edge-functions.mjs` (runs in CI) fails the build if any of the
five gated functions stops calling `isValidCronRequest`, or if a hardcoded JWT
literal reappears in function code.

## Inventory (live `cron.job`, 2026-08-26)

| jobid | jobname | schedule | function | auth |
|---|---|---|---|---|
| 4 | menerio-profile-normalize-jobs-6h | 22 */6 * * * | admin-normalize | x-cron-key via call_edge |
| 6 | wiki-restructure-sweep | 22 */6 * * * | wiki-restructure | x-cron-key via call_edge |
| 9 | gdrive-sync-backstop | */2 * * * * | gdrive-sync | x-cron-key (own env key, predates call_edge) |
| 10 | gdrive-watch-maintenance | 0 * * * * | gdrive-watch-maintenance | x-cron-key (own env key, predates call_edge) |
| 11 | profile-lint-nightly | 20 3 * * * | profile-lint | x-cron-key (own env key, predates call_edge) |
| 12 | profile-reconcile-sweep | 17 */2 * * * | profile-reconcile | x-cron-key via call_edge |
| 13 | profile-audit-sweep | */15 * * * * | profile-audit | x-cron-key via call_edge |
| 14 | powersync-keepalive | 17 */6 * * * | powersync-keepalive | x-cron-key via call_edge; **inactive since 2026-09-07**, see runbook |
| 15 | profile-explode-bags-nightly | 40 3 * * * | normalize-profile (explode_bags) | x-cron-key (own env key, predates call_edge) |

The three "own env key" jobs (gdrive, profile-lint, explode-bags) use secrets
stored as edge function environment variables plus a literal in the job
command. They work and stay as they are; migrating them onto `call_edge` is
optional cleanup, not a security fix.

## Runbooks

### PowerSync keepalive (job 14, inactive since 2026-09-07)

The six-hourly `powersync-keepalive` function opened a real authenticated
`/sync/stream` connection for four seconds and reported `ok: true` on every run.
PowerSync still deprovisioned the free-plan instance on 2026-09-07 01:06 UTC, one
hour after such a run: short connections are not what their inactivity counter
sees. Their rule is "no deploys or client connections for over 7 days", and a
deploy is what demonstrably counts and what restarts a deprovisioned instance.

The keepalive therefore moved to Michael's hub VPS as a scheduled deploy of the
unchanged sync config (`vps/hub/powersync-keepalive.sh` in the hub repo, root
cron every 6 h, deploys only when the instance is deprovisioned or five days have
passed since the last deploy). An unchanged deploy still creates a new sync rules
version and makes every client re-download its notes, so it deploys as rarely as
the window allows. Job 14 was set `active = false` the same day
(`20260907190000_powersync_keepalive_inactive.sql`); the function stays deployed
and can be re-enabled with `cron.alter_job(14, active := true)`.

### Deferred note worker (local implementation, not yet deployed)

`20260907130000_schedule_note_ai_jobs.sql` adds `drain-note-ai-jobs` at once per minute, **inactive**, plus a disabled worker setting with an empty account allowlist. It uses the existing `internal.call_edge` and `isValidCronRequest`, not another secret. Enabling the timer alone cannot enable execution.

The worker admits at most ten jobs per tick and holds at most two execution slots. Database claims enforce per-job exclusion across workers. Admission stops after 25 seconds, reserving 110 seconds for the final HTTP call plus margin under the documented 150-second free-plan runtime. This is an execution-capacity bound, not a change to the two-minute quiet period, ten-minute spacing or fifteen-minute pending target.

`internal.call_edge` has a ten-second HTTP timeout. The worker authenticates, reads its configuration and returns acceptance while `EdgeRuntime.waitUntil` runs the drain. HTTP 202 is not completion. Inspect the drain's final counts, `note_ai_jobs` states and `note_ai_completions`, as well as `net._http_response`. Unknown dispatch outcomes retain an uncertainty diagnostic instead of an immediate paid retry.

The full staged activation, verification and pause procedure is in [NOTE_AI_ROLLOUT.md](NOTE_AI_ROLLOUT.md). Nothing in this local change enables production execution.

**Rotate the shared secret** (no redeploys, takes effect on the next run of
each job):

```sql
UPDATE internal.cron_secret
SET value = encode(extensions.gen_random_bytes(32), 'hex')
WHERE id = 1;
```

Functions cache the old value for at most 60 seconds.

**Trigger a job manually** (returns a pg_net request id):

```sql
SELECT internal.call_edge('profile-audit',
  jsonb_build_object('cron', 'profile-audit', 'limit', 25));
```

**Check whether runs actually succeed.** `cron.job_run_details` only says the
SQL ran; pg_net posts asynchronously. The HTTP outcome lands here:

```sql
SELECT id, status_code, timed_out, error_msg, created
FROM net._http_response ORDER BY created DESC LIMIT 25;
```

A 200 or 202 is a healthy sweep. A 401 means the job is not sending the
current secret: check that its command goes through `internal.call_edge`.

**Add a new scheduled function.** Schedule it as
`select internal.call_edge('<fn>', '<payload>'::jsonb)`, gate the function with
`isValidCronRequest` from `_shared/cron-auth.ts`, keep `verify_jwt = false` for
it in `supabase/config.toml`, add it to `CRON_GATED` in
`scripts/check-edge-functions.mjs`, and add it to the inventory above.
