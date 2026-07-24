## Why it freezes today

Two problems compound on the Review Queue at 2,300 items:

1. **All rows render at once.** `src/pages/ReviewQueue.tsx` loads every pending item into a single `combinedReviewItems.map(...)` list — no pagination, no virtualization. That's ~2,300 Cards mounted simultaneously.
2. **Bulk "Keep / Roll Back / Never Again" fires ~2,300 individual mutations.** Each `updateStatus.mutate(...)` triggers a React Query invalidation, which refetches all 2,300 rows and re‑renders the giant list. It also broadcasts a cross-window cache-sync message per call (recent `query-sync` addition). Result: O(N²) DOM work + thousands of network round-trips → the tab pins a CPU core and the OS starves.

## Fix (frontend only, no schema changes)

### 1. Paginate the on-screen list
- Add client-side pagination in `ReviewQueue.tsx`: show 50 items per page with Prev / Next / "Page X of Y" controls above the list.
- Keep `useReviewQueue` fetching the full lightweight list (id, title, small payload) so counts and bulk actions still work, but only render the current page's slice. This alone cuts steady-state DOM from ~2,300 Cards to 50.

### 2. Batch the bulk actions and suppress intermediate refetches
Rewrite `handleKeepAll`, `handleRemoveAll`, `handleNeverAgainAll` so they:

- **Split items into two buckets:**
  - *Already-applied* items (`target_entity_id && applied_at`): flip status in a single Supabase bulk update — `supabase.from("review_queue").update({ status, reviewed_at }).in("id", ids)` — instead of N mutations.
  - *Not-yet-applied* items: process through the existing per-item accept/revert path (they need side effects) but in **small concurrent batches** (e.g. 10 at a time via a simple worker pool) with a progress toast ("Keeping 450 / 2,300…").
- **Pause query invalidations during the loop:** don't call `updateStatus.mutate` per item (which auto-invalidates). Do the DB writes directly, then invalidate the review-queue queries **once** at the end, and broadcast a single cross-window sync message.
- Disable the bulk buttons while running and show a progress indicator.

### 3. Cheaper re-renders
- Extract each row into a memoized `ReviewItemCard` / `WikiRevisionCard` component wrapped in `React.memo` so incremental updates don't re-render every card.
- Compute `combinedReviewItems` inside a `useMemo` keyed on the source arrays.

### 4. Safety
- Add a confirm dialog before bulk Keep/Roll Back/Never Again when the queue exceeds a threshold (e.g. 100 items), showing the count.
- Keep the existing per-item error isolation and failure toasts, but coalesce them into a single summary toast ("Kept 2,287; 13 failed") to avoid flooding the toast stack.

## Out of scope (call out, don't change now)
- No changes to `normalize-profile`, `useReviewQueue`, RLS, or DB schema.
- No virtualization library added yet — pagination + memoization should be enough. If a user routinely exceeds ~500 items per page we can revisit with `@tanstack/react-virtual`.

## Files touched
- `src/pages/ReviewQueue.tsx` — pagination, batched bulk handlers, memoized row components, confirm dialog for large bulk ops.
- (Optional) small helper in the same file or a new `src/pages/reviewQueueBulk.ts` for the worker-pool utility, if it keeps the page readable.

## Expected outcome
Opening the queue with 2,300 items renders ~50 cards. Clicking "Keep" processes them in the background with a progress toast, issues at most a handful of DB round-trips for already-applied items plus batched work for the rest, and refreshes the UI once at the end — no more frozen tab.
