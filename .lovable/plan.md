
## Three-Option Review Queue: Accept / Skip / Never

### Design

Three statuses stored in `review_queue.status`:
- **"accepted"** — user accepted the suggestion (existing behavior)
- **"skipped"** — user skips for now; suggestion reappears next time the note is processed (new)
- **"dismissed"** — permanently dismissed; never recreated (existing behavior, already handled by dedup logic)

### Changes

**1. UI: `src/pages/ReviewQueue.tsx`**
- Replace the two-button layout with three buttons:
  - **Accept** (green, primary) — calls `updateStatus("accepted")`, same behavior as today
  - **Skip** (ghost) — calls `updateStatus("skipped")`, toast says "Skipped for now"
  - **Never** (ghost, destructive text) — calls `updateStatus("dismissed")`, toast says "Won't suggest again"
- Button order right-to-left: Never | Skip | Accept

**2. Hook: `src/hooks/useReviewQueue.ts`**
- Update the `updateStatus` mutation type to accept `"accepted" | "skipped" | "dismissed"`
- No other changes needed — the query already filters for `status = 'pending'`

**3. Edge function dedup: `supabase/functions/process-note/index.ts`**
- Already includes `"dismissed"` in the dedup check (from previous fix)
- Change: exclude `"skipped"` from the dedup set, so skipped suggestions get recreated as `"pending"` on next note processing
- Specifically: when building the `existingSet`, only include `["pending", "accepted", "dismissed"]` (which is what the current code does after our last fix)
- Skipped items should be reset to `"pending"` when the note is reprocessed — add logic after dedup filtering to update any `"skipped"` items for matching suggestions back to `"pending"`

**4. No migration needed** — the `status` column is `text` type, so "skipped" works without schema changes. The partial unique index only covers `WHERE status = 'pending'`, so skipped/dismissed items won't conflict.

### Files
- `src/pages/ReviewQueue.tsx` — three buttons
- `src/hooks/useReviewQueue.ts` — updated type
- `supabase/functions/process-note/index.ts` — re-pending skipped items on reprocess
