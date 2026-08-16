# Keep the PowerSync instance alive

Yes — this can be automated from the backend. The reliable way is a small scheduled job that makes a **real sync connection** to the PowerSync instance on a fixed interval, so the instance registers genuine activity rather than just a ping.

## Important caveat first

PowerSync Cloud deprovisions instances on free/dev plans after a period of inactivity. Two things are worth knowing before we build:

- A plain health probe (`/probes/liveness`) may not count as activity — it is served by the container without touching sync. So the job must do something closer to a real client: authenticate and open a sync stream.
- The permanent fix is on the PowerSync side: a paid/always-on plan, or asking PowerSync support to disable auto-deprovision for this instance. The cron job is a workaround that keeps the clock ticking; it does not change the plan policy.

Recommendation: build the keepalive **and** confirm with PowerSync whether authenticated stream traffic resets their inactivity timer.

## What gets built

1. **New edge function `powersync-keepalive`**
   - Mints a valid Supabase user JWT for a dedicated keepalive identity (service-role generated session for an existing account, no new credentials in code).
   - Calls the PowerSync instance's authenticated sync endpoint with that token, reads a small amount of the stream, then closes the connection (a few seconds, not a persistent client).
   - Falls back to an unauthenticated GET against the instance host if the authenticated call fails, so at minimum the host is touched.
   - Logs the outcome (reachable / authenticated / bytes received / error) so we can see in the function logs whether the keepalive is actually working.

2. **Scheduled trigger**
   - `pg_cron` job invoking the function via `pg_net`, running every 6 hours (4 hits/day — comfortably inside any inactivity window, negligible cost).
   - Uses the standard pattern already in this project for scheduled edge functions.

3. **Visibility**
   - The function returns a JSON status, and failures are logged. If you want, it can also raise an admin notification via the existing `notify-admin` function after N consecutive failures, so a second deprovisioning is noticed the same day rather than weeks later.

## Technical notes

- Instance URL comes from the existing hardcoded value in `src/sync/config.ts`; the function will read it from a Supabase secret (`POWERSYNC_URL`) with that value as default, so a re-provisioned instance only needs the secret updated, not a redeploy.
- The function is JWT-verification-off in `supabase/config.toml` (cron-invoked), and does no user-data access beyond minting the keepalive token.
- No frontend changes; `SyncManager`, the reachability probe and the offline fallback stay exactly as they are.

## Open question

Should the keepalive also send a **write** (a tiny upsert into a throwaway synced row) rather than only reading the stream? That is the strongest guarantee of "activity", at the cost of one dummy row in the database. Default in this plan: read-only stream connection, no writes.
