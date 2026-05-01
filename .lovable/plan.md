## Problem

At midnight on May 1 (UTC), many concurrent requests (dashboard widgets, AI chat, search, etc.) all tried to create the new monthly allowance period at the same time. The `ensure-token-allowance` Edge Function does a "check then insert" without a unique constraint, so each concurrent caller inserted a separate row. Database shows up to **77 duplicate rows per user** for the same period.

This breaks two flows:

1. **"Insufficient AI credits" everywhere.** `checkBalance()` in `supabase/functions/_shared/llm-credits.ts` calls `v_ai_allowance_current` with `.maybeSingle()`. PostgREST returns an error when more than one row matches `.maybeSingle()`, so `data` is `null` → `allowed: false` → every AI feature throws `INSUFFICIENT_CREDITS`.

2. **Admin "No active period" message.** `openTokenModal()` in `src/pages/Admin.tsx` queries the same view with `.maybeSingle()` and falls into the empty-state branch.

The actual `tokens_used` is 0 across the duplicates — the user has plenty of credits, the queries just can't read them.

## Fix

### 1. Database migration — deduplicate + prevent recurrence

- Collapse duplicate rows per `(user_id, period_start, period_end)`: keep the row with the highest `tokens_used` (preserves usage if any exists), sum `tokens_used` across duplicates into the survivor as a safety net, delete the rest.
- Add a partial **unique index** `ai_allowance_periods (user_id, period_start, period_end)` so future race conditions raise a duplicate-key error instead of silently inserting.

### 2. `ensure-token-allowance` Edge Function

Switch the insert to `.upsert(..., { onConflict: "user_id,period_start,period_end", ignoreDuplicates: true })` and re-select the existing row when conflict happens. This makes concurrent calls idempotent.

### 3. Defensive read paths

Even after dedup, harden the read sites so a single stray duplicate never breaks billing again:

- `supabase/functions/_shared/llm-credits.ts` → `checkBalance`: replace `.maybeSingle()` with `.order("period_start", { ascending: false }).limit(1)` and read `data?.[0]`.
- `src/pages/Admin.tsx` → `openTokenModal`: same change (order by `period_start` desc, `limit(1)`, take first row).

### 4. No changes needed to `deduct_ai_tokens` RPC

It already uses `ORDER BY period_start DESC LIMIT 1 FOR UPDATE`, so it tolerates duplicates. After the unique index is in place, duplicates can't be created anyway.

## Files touched

- New migration: dedupe rows + add unique index on `ai_allowance_periods`.
- `supabase/functions/ensure-token-allowance/index.ts` — upsert with conflict target.
- `supabase/functions/_shared/llm-credits.ts` — robust balance read.
- `src/pages/Admin.tsx` — robust allowance read in token modal.

## Verification after deploy

- Re-query `ai_allowance_periods` for May 2026 → expect exactly 1 row per user.
- Open the Admin → token modal for any user → "Granted / Used" populated, no "No active period" message.
- Trigger an AI feature (e.g. AI Chat) → no 402 response.
