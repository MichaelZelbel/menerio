## What's happening

Your last "Keep all" job (01:33 UTC today) recorded `total: 6, done: 6, failed: 0` — the backend reported complete success, yet items stayed in the queue. So the bug is not that processing stops early; it's that some items are counted as done without ever being applied.

## Root cause (confirmed by reading the code)

`review-queue-bulk` delegates profile-related items to the `normalize-profile` edge function and authenticates with the **service-role key**, passing `user_id` in the body:

```
Authorization: Bearer SERVICE_ROLE   +  body { user_id }
```

But `normalize-profile` resolves the caller like this (index.ts:486):

```ts
const { data: { user } } = await anonClient.auth.getUser(authHeader.replace("Bearer ", ""));
if (authErr || !user) return json({ error: "Unauthorized" }, 401);
```

A service-role API key is **not** a user JWT, so `getUser` fails and every one of these calls returns **401**. `body.user_id` is never read. This affects both delegated paths:

- `normalize_profile_entry` → `keepPending()` fires the fetch and **never inspects the response**, then counts `bump(1, 0)`.
- `add_profile_entry` → `bulk_profile_reviews`; on 401 the body has no `summary`, so `failedCount = Number(undefined || 0) = 0` and the whole chunk is counted as successful.

That matches the leftovers in your queue: the remaining rows are almost all `normalize_profile_entry` (plus `add_profile_entry`), while the item types handled inline by `review-queue-bulk` (contacts, aliases, relationships, moments, wiki revisions) went through.

A second, smaller silent-failure path exists even once auth is fixed: `acceptProfileEntryReview` returns `{ok:false, outcome:"rejected_duplicate"}` (e.g. blocked by the duplicate-fact trigger, invalid payload) and leaves the row `pending_review`, but `bulk_profile_reviews` only counts explicit exceptions in `summary.failed`, so those also report as done.

## The fix

**1. Make `normalize-profile` accept trusted service-role calls**
- If the bearer token equals `SUPABASE_SERVICE_ROLE_KEY`, take `userId` from `body.user_id` (validated as a UUID) instead of calling `getUser`. Otherwise keep the existing user-JWT path unchanged. All existing ownership checks (`row.user_id !== userId`) stay in place, so no privilege widening.

**2. Stop swallowing failures in `review-queue-bulk`**
- `keepPending()` `normalize_profile_entry` branch: check `res.ok` and the JSON body; throw when the call failed or `ok !== true` and it wasn't resolved server-side, so the row counts as `failed` instead of `done`.
- `bulk_profile_reviews` branch: treat a non-2xx response or a missing `summary` as a full-chunk failure; also count `rejected_duplicate` toward `failed`.

**3. Make "done" mean actually resolved (verification pass)**
- After the keep loop, re-query the processed IDs for rows still in a pending status and reclassify them from `done` to `failed`, writing a short reason into the job's `last_error`. This guarantees the progress counter can never claim success while rows remain in the queue.

**4. Surface it in the UI**
- `ReviewQueue.tsx` already reads `failed` from the job row; show a warning toast ("Kept 3, 3 could not be applied") instead of a plain success message when `failed > 0`, and keep the remaining items visible.

**5. Resolve the current stragglers**
- After deploying, re-run "Keep all"; the previously-401'd items should now apply. Anything that still fails will show a real reason in the job's `last_error` rather than disappearing silently.

## Technical notes

- Files: `supabase/functions/normalize-profile/index.ts` (auth block only), `supabase/functions/review-queue-bulk/index.ts` (keep paths + verification), `src/pages/ReviewQueue.tsx` (toast copy).
- No database migration needed; `review_queue_bulk_jobs` already has `failed` and `last_error`.
- Worth checking after: `grep` for other edge functions calling `normalize-profile` with the service-role key — they'd have the same silent 401.
