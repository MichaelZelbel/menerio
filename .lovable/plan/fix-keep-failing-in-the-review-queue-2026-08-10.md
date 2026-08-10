# Fix "Keep" failing in the Review Queue

## What is actually happening

Two separate bugs, both confirmed against the live database and code.

### 1. The clean-up suggestions genuinely cannot be applied

The pending items are "Clean up your profile: …" (profile normalization) suggestions.
Applying one means: write the corrected entry, then delete the old ones.

The database has a duplicate-prevention trigger on `profile_entries`. When the corrected
entry is equal to — or contained in — an entry that already exists (which is exactly the
case when the old row is still present, because deletion happens afterwards), the trigger
**silently swallows the write** (returns no row instead of raising an error).

The application code interprets "no row came back" as a hard failure, aborts, never deletes
the old rows, and leaves the item in the queue. It will fail forever, every time Keep is pressed.

### 2. The toast math is wrong

The bulk job counts each failure twice and then subtracts them from the success counter,
which is how "-3 kept, 6 could not be applied" appears for 3 items. Failures are counted once
in the worker loop and a second time in the final verification pass.

## The fix

### Applying a clean-up suggestion (`_shared/profile-normalization.ts`)

- When the insert or update returns no row, do not treat it as a failure. Look up the
  entry the trigger deduplicated against (same user, same contact, matching label/value keys)
  and treat that row as the survivor.
- With the survivor known, still delete the superseded `before` entries and report success
  with the survivor's id — the user's intent (one clean entry instead of several) is fulfilled.
- If no survivor can be found at all, report a distinct, resolvable reason rather than a
  generic `insert_failed`.

### Closing the queue row (`normalize-profile/index.ts`, action `apply`)

- Treat `already_exists` and the new "absorbed by existing entry" outcome the same way
  `stale`/`empty` are treated today: the row is resolved server-side and leaves the queue
  (`kept` when an entry id is known, `removed` otherwise), returning 200.
- A suggestion may never be able to loop back into the queue after a successful resolution.

### Bulk counters (`review-queue-bulk/index.ts`)

- The verification pass becomes authoritative instead of additive: after processing,
  recompute `failed` as the number of rows that are still pending and `done` as
  `total − failed`, clamped at zero. No negative numbers, no double counting.
- Keep the explanatory `last_error` text.

### Toast wording (`src/pages/ReviewQueue.tsx`)

- Show a single, coherent sentence, e.g.
  `12 changes kept · 3 could not be applied and stay in the queue — <reason>`.

## Verification

- Re-run Keep against the currently stuck items and confirm via SQL that the queue rows leave
  `pending_review` and that the profile entries are collapsed correctly (no duplicates, no lost facts).
- Confirm the toast reports non-negative, consistent numbers.
