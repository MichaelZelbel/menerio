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
| 14 | powersync-keepalive | 17 */6 * * * | powersync-keepalive | x-cron-key via call_edge |
| 15 | profile-explode-bags-nightly | 40 3 * * * | normalize-profile (explode_bags) | x-cron-key (own env key, predates call_edge) |

The three "own env key" jobs (gdrive, profile-lint, explode-bags) use secrets
stored as edge function environment variables plus a literal in the job
command. They work and stay as they are; migrating them onto `call_edge` is
optional cleanup, not a security fix.

## Runbooks

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
