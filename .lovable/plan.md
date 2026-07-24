
# Make Review Queue bulk actions server-side

## Why this is still slow

You're right — the design is wrong. Even after yesterday's batching, "Keep all" / "Roll Back all" / "Never Again all" still does the vast majority of the work **in your browser**:

1. `useReviewQueue` loads up to ~1,000 items into memory and re-fetches every 60 s. With 2,000 pending items the query alone re-serializes a huge JSON payload on a timer.
2. Each bulk button walks the in-memory `items` array and, for every single row, runs multiple Supabase round-trips from the browser (insert profile entry, create moment, insert relationship, update alias, upsert suppression, delete moment participants, etc.). Only `add_profile_entry` is currently batched server-side; everything else is per-item.
3. Each processed item calls `setBulkProgress(...)`, forcing a React re-render of the whole page (including the 50 rendered cards). Thousands of re-renders + thousands of fetches on the main thread = the freeze you saw.
4. After the run, every relevant query is invalidated → another full re-fetch + re-render.

The browser has no reason to touch any of this. The only per-item work the client needs is the render for the ~50 rows currently on screen.

## What to change (frontend only, plus one edge function)

### 1. New edge function `review-queue-bulk`

One endpoint that handles every bulk action for the current user, entirely server-side.

Input:
```
{ action: "keep" | "rollback" | "never_again",
  scope: "all" | { ids: string[] },      // "all" = every pending row for this user
  types?: string[]                        // optional filter (unused for now, future-proof)
}
```

Behavior (executed with per-request Supabase client using the caller's JWT so RLS still applies):

- Load the target `review_queue` rows in server-side pages of 500.
- For each row, run the same side-effects the current client code runs (`revertAppliedChange`, `createSuppression`, alias handling, moment/participant delete, relationship delete, contact delete, `add_profile_entry` batching, wiki revision rollback via `wiki_rollback_revision` RPC, etc.). All of this happens inside the edge function using the service-role client — one DB region, no browser round-trips.
- Flip `status` / `blocked_at` in bulk with a single `UPDATE ... WHERE id = ANY($1)` per 500-row page.
- Wrap the whole thing in `EdgeRuntime.waitUntil(...)` and return `202 { job_id }` immediately so the HTTP call never times out.
- Write progress to a tiny row in a new lightweight table `review_queue_bulk_jobs` (`id, user_id, action, total, done, failed, status, started_at, finished_at, last_error`). RLS: owner-only.

### 2. Frontend: replace the current bulk machinery in `src/pages/ReviewQueue.tsx`

- Delete `runBulk`, `runInBatches`, `bulkFlipStatus`, and all per-item bulk paths.
- `handleKeepAll` / `handleRemoveAll` / `handleNeverAgainAll` become one-liners that POST to `review-queue-bulk` with `scope: "all"` and receive a `job_id`.
- Add a small `useBulkJob(jobId)` hook that polls `review_queue_bulk_jobs` every 2 s (not 60 ms) via `useQuery` and drives the existing "Processing X / Y…" indicator. Stop polling on `status in ('done','error')`.
- On job completion, invalidate the review-queue queries **once**.

### 3. Frontend: stop the hidden cost of just *loading* the page

Independent of bulk actions, `useReviewQueue` today pulls the full row shape for every pending item and refetches on a timer.

- Change the list query to `select` only what a card renders (`id, suggestion_type, title, description, source_note_id, target_entity_id, applied_at, is_sensitive, payload, created_at, status, source_note:notes(title)`), and cap it with `.range(0, 499)` — the cards on screen never need more than the first page.
- Keep the separate `count` query (already `head: true`) for the "2,000 pending changes" label.
- Drop `refetchInterval: 60_000` on the list query (keep it on the count query only, or move to 5 min). The queue does not need to auto-refresh while the user is staring at it; the count badge is enough.
- Add pagination cursors so "Next page" fetches the next 500 from the server instead of relying on an in-memory slice of everything.

### 4. Frontend: cheap render hygiene

- Throttle any remaining progress `setState` to at most one update per 250 ms (`requestAnimationFrame` or a simple `Date.now()` gate) so a large job can't flood React.
- Wrap the card component in `React.memo` keyed by `item.id` so unrelated progress updates don't re-render 50 cards.

## Files to touch

- `supabase/functions/review-queue-bulk/index.ts` — new.
- `supabase/migrations/*` — new table `review_queue_bulk_jobs` with RLS + grants.
- `src/hooks/useReviewQueue.ts` — trim `select`, add server pagination, drop list refetch interval.
- `src/pages/ReviewQueue.tsx` — remove per-item bulk logic, wire to new edge function + job polling, memoize card, throttle progress.
- (No changes to the individual per-row Keep / Roll Back / Never Again buttons — those already do one item at a time and are fine.)

## Expected result

Clicking "Keep 2,000 changes" fires a single HTTP request, returns in ~50 ms with a job id, and the UI shows a progress bar driven by a 2 s poll. The browser does zero per-item work, no thousands of round-trips, no thousands of re-renders. Even with 20,000 items the page should stay fully interactive.

## Out of scope (not changing)

- Server-side dedup / normalizer logic itself.
- Per-row buttons on individual cards.
- The wiki-revision review UI, other than being handled by the same new endpoint when `scope: "all"`.
