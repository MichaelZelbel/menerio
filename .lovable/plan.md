## Goal
Make duplicate prevention a backend invariant instead of another browser-triggered cleanup pass.

The fix should guarantee that obvious duplicates cannot be inserted again, clean existing duplicates in the background, and keep the browser out of heavy normalization work.

## Confirmed current gaps
- Profile entries can still be created directly from the browser in Review Queue (`src/pages/ReviewQueue.tsx`) and profile hooks (`src/hooks/useProfile.ts`, `src/hooks/useContactProfile.ts`). That bypasses the token-aware backend guard at the final write step.
- The extraction pipeline deduplicates before creating suggestions, but an accepted suggestion can become stale by the time it is approved and still insert a duplicate.
- The database has no uniqueness guard for profile entries beyond the primary key; exact/case-normalized duplicates can exist.
- The normalizer is currently cleanup-after-the-fact. It helps, but it is not a write barrier.

## Plan

### 1. Add a database-level exact duplicate guard
Create a migration that:
- Adds a deterministic profile-entry fingerprint function for obvious duplicates:
  - trims whitespace
  - collapses repeated spaces
  - compares case-insensitively
  - handles `contact_id IS NULL` consistently for owner profiles
- Cleans current exact duplicates once so the index can be added safely.
- Adds a unique index preventing future exact duplicates per:
  - user
  - owner/contact subject
  - category
  - normalized label
  - normalized value

This stops the simplest duplicate class permanently even if a missed code path tries to write one.

### 2. Centralize profile entry writes in one server-side path
Add a small authenticated Edge Function action, likely inside `normalize-profile` or a new focused `profile-entry-write` function, used for creating profile entries.

It will:
- Validate input with Zod.
- Resolve/create the profile category server-side.
- Canonicalize category/label using the existing profile schema.
- Re-check saved profile entries at the moment of write.
- Use the existing token-aware dedup logic for list-valued fields.
- Return one of these outcomes instead of blindly inserting:
  - `inserted` — genuinely new fact
  - `already_exists` — exact or singleton duplicate, no write
  - `merged_list` — merged new tokens into an existing list row
  - `rejected_duplicate` — duplicate blocked by the DB guard
- Enqueue normalization for that subject after the write.

Then update browser code so it no longer inserts profile entries directly for:
- accepting `add_profile_entry` review items
- owner profile quick/manual entry creation
- contact profile quick/manual entry creation

Existing edit/delete paths can remain direct, but they will trigger background normalization.

### 3. Add a lightweight background normalization job queue
Create a server-side job table for normalization work, coalesced by user + subject.

A database trigger on `profile_entries` will enqueue a job whenever an entry is inserted, updated, or deleted. This means normalization is automatic even if the write came from an old client path, MCP, review queue, or a future integration.

The job runner will:
- process only changed subjects, not every contact every six hours
- claim jobs in small batches
- use `EdgeRuntime.waitUntil` so requests return quickly
- skip unchanged profiles using the existing input hash logic
- run deterministic cleanup first, LLM cleanup only when needed
- write audit rows to Review Queue only for real changes

### 4. Make the normalizer stricter and idempotent
Extend the deterministic normalizer so “obvious duplicate” includes:
- same canonical label + same normalized value
- case-only differences, e.g. `Partner` vs `partner`
- health checkbox artifacts, e.g. `BPD: true` → `Health conditions: BPD`
- list-valued overlaps, e.g. repeated `BPD`, repeated foods, repeated allergies
- known alias families already represented in `profile-dedup.ts`

The normalizer should be safe to run repeatedly: after it finishes once, running it again should produce zero changes for the same input.

### 5. Move heavy Review Queue profile actions off the browser
For bulk approval/removal of profile-related review items:
- Add a server-side batch action for profile suggestions.
- The browser sends one request with item IDs.
- The Edge Function processes in chunks and returns progress/summary.
- The browser only polls/refetches; it does not loop through thousands of mutations.

This avoids the Windows-machine-freeze scenario when the queue is huge.

### 6. Run one server-side cleanup sweep after deployment
After the migration and server write path are in place:
- Trigger the background normalizer for all existing subjects once.
- Let it clean exact/list duplicates automatically.
- Leave only genuinely ambiguous conflicts in Review Queue.
- Verify Yumei’s profile specifically after the sweep.

### 7. Add regression tests
Add tests for:
- exact duplicate fingerprinting
- case/spacing duplicate blocking
- list-token deduplication
- boolean health transforms
- accepting the same profile suggestion twice
- concurrent duplicate writes
- bulk review action not issuing N browser mutations

## Expected result
- Obvious duplicates are blocked at write time, not merely cleaned later.
- Existing duplicates are cleaned by the backend without user clicks.
- Future profile changes automatically enqueue background cleanup.
- The browser stays responsive because it only triggers/polls server work, not thousands of per-item operations.