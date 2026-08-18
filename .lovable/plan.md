# Fix: "Keep" reports success but the suggestion stays in the queue

## What the evidence shows

The one item in your queue is a profile clean-up suggestion ("Clean up your profile: Previous employer").
Every Keep attempt produces the same call and the same answer:

```text
POST /functions/v1/normalize-profile  {"action":"apply","review_id":"44bbdd0d…"}
→ 409  {"ok":false,"reason":"insert_failed"}
```

The row therefore never leaves `pending_review`, and it will fail identically forever.

Two separate defects combine into "it says it worked, but nothing happened":

1. **Server:** applying the suggestion writes the corrected entry *first* and deletes the
   superseded entry *afterwards*. While the old row is still present, the duplicate-prevention
   trigger on `profile_entries` blocks the new write (the canonical value "Infosys Consulting"
   is contained in the old mixed "Employer" mega-entry). The write is reported as a failure and
   the operation aborts before the delete, so nothing changes on either side.
2. **Frontend:** `handleAcceptNormalize` in `ReviewQueue.tsx` treats *any* HTTP 409 as "stale"
   and shows a neutral/positive toast, hiding the real reason. The bulk path counts it as
   failed but the summary wording still reads like success.

Note: I could not read the edge-function logs or the database this turn — the Supabase
workspace binding is returning `SUPABASE_FORBIDDEN`. The diagnosis above comes from the
captured network response plus the code paths; step 0 below confirms it before the fix ships.

## The fix

**Step 0 — confirm (needs the Supabase connection back)**
Read the `normalize-profile` logs for review `44bbdd0d…` and print the exact Postgres error
behind `insert_failed`. If it is not the duplicate guard, the rest of the plan is re-aimed at
whatever the log names before any code changes.

**Step 1 — apply the change in the right order (`_shared/profile-normalization.ts`)**
Inside `applyNormalization`, delete the superseded `before` rows *before* writing the canonical
entry, in one transactional RPC so a failure restores them byte-for-byte. This removes the
condition that makes the guard block the write, without weakening the guard itself.
If the canonical write still cannot land, restore the deleted rows and report the real
Postgres message instead of a bare `insert_failed`.

**Step 2 — a suggestion may never be unresolvable (`normalize-profile/index.ts`)**
Any apply outcome that cannot succeed on retry closes the queue row (`removed`) with the
reason recorded, and returns 200. Only genuinely transient errors keep the row pending.
The queue can no longer accumulate permanently stuck items.

**Step 3 — honest reporting (`src/pages/ReviewQueue.tsx`)**
Stop equating 409 with "stale": only `reason === "stale"` is stale. Everything else shows an
error toast carrying the server's reason. The bulk summary reports failures plainly
("1 could not be applied and stays in the queue — <reason>").

**Step 4 — verify**
Press Keep on this exact item and confirm via SQL that the queue row leaves `pending_review`,
that "Previous employer: Infosys Consulting" exists once in `professional`, and that no other
profile facts were lost.

## Technical notes

- New SQL function `apply_profile_normalization(user_id, delete_ids, canonical…)` running the
  delete + insert/update in one transaction; the edge function calls it instead of issuing
  separate PostgREST writes.
- The existing `findAbsorbingEntry` fallback stays as the second line of defence.
- No trigger, policy or grant is relaxed.
