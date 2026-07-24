## What is going wrong

I checked the live database and the current deployed runner state. The automatic cleanup is not actually reaching the normalizer.

Confirmed findings:

- Yumei still has duplicate-like profile rows, especially same-label variants such as `Pets`, `Personality traits`, `VRChat setup/equipment`, `Health conditions`, and similar list/near-duplicate fields.
- The exact duplicate database guard is not the main issue here: the duplicates are mostly semantic/list-overlap duplicates, not byte-for-byte identical rows.
- A normalization job for Yumei is queued, but it has not been processed.
- The scheduled cron job is firing every 6 hours, but the HTTP response from `admin-normalize` is `403 {"error":"forbidden"}`.
- The cron command is sending `Authorization: Bearer ` plus `current_setting('supabase.service_role_key', true)`, but that database setting is empty in this project. So the job reports as “succeeded” in cron because it successfully made an HTTP request, while the Edge Function rejects the request.
- `admin-normalize` also is not listed in `supabase/config.toml`, so depending on deployment defaults it may be less explicit than the other internal functions.
- A previous `profile_normalization_runs` row for Yumei is stuck in `running`, which can mislead diagnostics even though the real blocker is the rejected cron request.

So the reason “nothing happens after six hours” is: the scheduler is running, but it is unauthenticated, so the backend refuses to do the work.

## Fix plan

### 1. Make the scheduled runner authenticate correctly

Update the scheduled cron job so it calls `admin-normalize` with a real secret that already exists in Edge Function secrets, instead of relying on the missing database setting.

Best minimal approach:

- Use `MCP_ACCESS_KEY` as the shared internal admin key.
- Store the value in a database setting or secure cron-compatible mechanism only if available; otherwise update the cron call to use the anon key for routing plus an `x-admin-key` header whose value is injected via SQL configuration.
- If the secret cannot be read from Postgres safely, replace the pg_cron trigger with a small scheduled Edge Function pattern that can read Edge secrets directly.

### 2. Make `admin-normalize` cron-safe and explicit

Update `supabase/config.toml` to include:

```toml
[functions.admin-normalize]
verify_jwt = false
```

Keep the function protected by its own in-code shared-secret check. This matches how the project handles internal/server-auth functions.

### 3. Repair stale normalization state

Clean up stale `profile_normalization_runs` rows that are stuck in `running` for too long by marking them `failed` or allowing the next runner invocation to overwrite them cleanly.

This prevents the UI/diagnostics from implying that normalization is currently active when it is not.

### 4. Trigger Yumei immediately after the auth fix

After the cron authentication is fixed, invoke `admin-normalize` for Yumei directly with:

- `scope: "contact"`
- Yumei’s contact ID
- `includeNotesContext: true`
- `changed_only: false`

Then verify:

- the function returns `202`
- the run finishes as `completed`
- the queued job is marked `completed`
- the duplicate-like same-label/list-overlap groups shrink
- any ambiguous conflicts remain in Review Queue instead of being auto-merged

### 5. Improve observability so this failure is obvious next time

Add logging and status reporting so a future cron failure cannot look successful:

- Log every rejected `admin-normalize` call with reason `forbidden`.
- Store the last scheduled-run HTTP status somewhere visible, or add a small health query/check that reports:
  - queued jobs count
  - oldest queued job age
  - latest `admin-normalize` status
  - latest cron HTTP status

### 6. Optional but recommended: make the normalizer more direct for obvious list duplicates

Because many Yumei duplicates are list-overlap/near-duplicate rows rather than exact duplicates, strengthen deterministic normalization so it merges obvious same-label list rows before asking the LLM.

Examples:

- `Pets: Cat named Pac, guinea pig` + `Pets: Cat (Pac), guinea pig` → one canonical row
- `VRChat equipment` + `VRChat setup` with overlapping equipment tokens → one row or one canonical label
- repeated health-condition tokens inside one long value → dedupe tokens in-place

This keeps the LLM for ambiguous decisions, but makes the easy cleanup reliable and cheap.

## Expected result

- The six-hour background job actually runs instead of returning 403.
- Yumei’s queued normalization job is processed without browser involvement.
- Future profile writes enqueue jobs and the backend processes them automatically.
- Obvious duplicates are cleaned server-side; ambiguous profile conflicts are left for review instead of silently losing information.