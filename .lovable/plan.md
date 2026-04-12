
Fix the Lucy review-queue issue by tightening the profile-extraction pipeline, not the UI.

What I found
- The note is being processed: recent `process-note` logs show the function ran for the Lucy note.
- The LLM is returning a fact-like result for Lucy, e.g. `contact_name: "Lucy", category_slug: "location", label: "Current city", value: "Beijing"`.
- But immediately after that, the function logs `No profile facts extracted from note ...`.
- That strongly indicates the parser is discarding valid single-object responses before they ever reach the review queue.

Root cause
- In `supabase/functions/process-note/index.ts`, `generateProfileSuggestions()` only accepts:
  - a top-level array, or
  - an object containing an array under some wrapper key
- If the model returns one fact as a plain object, it becomes `[]` and gets dropped.
- That matches the logs exactly for Lucy.

Implementation plan
1. Fix profile-response parsing in `supabase/functions/process-note/index.ts`
- Accept all three shapes:
  - array of facts
  - wrapper object containing an array
  - single fact object with `contact_name/category_slug/label/value`
- Normalize into a single `extractedFacts` array before validation.

2. Add stronger defensive normalization
- Trim strings for `contact_name`, `category_slug`, `label`, and `value`.
- Normalize case before contact matching and dedup checks.
- Keep existing category whitelist and matched-person validation.

3. Improve logging so this is debuggable next time
- Log which parse shape was detected: `array`, `wrapped-array`, `single-object`, or `invalid`.
- If facts are filtered out, log counts/reasons at a compact level:
  - parsed count
  - valid count
  - duplicate count
  - queue-created count

4. Re-run / verify the end-to-end flow after the fix
- Update the Lucy note processing flow again so the repaired parser runs.
- Confirm the note produces a pending `add_profile_entry` item in `review_queue`, unless it is already an accepted/dismissed duplicate.
- If it is a duplicate, identify exactly where it already exists:
  - existing `profile_entries`
  - existing `review_queue` item with pending/accepted/dismissed status

5. Small follow-up hardening
- Review whether profile suggestions should also revive `skipped` items the same way general review suggestions do.
- If the current behavior is causing “nothing appears” confusion, I’ll update it so skipped profile suggestions can reappear when the note changes materially.

Files to update
- `supabase/functions/process-note/index.ts`

Verification checklist
- Edit/save “About Lucy”
- Confirm `process-note` logs show `single-object` or `array` parsed successfully
- Confirm either:
  - a new pending profile suggestion appears in Review Queue, or
  - a precise duplicate reason is logged and traceable

Technical note
- This looks like a backend parsing bug, not a markdown-storage problem and not a Review Queue page rendering problem.
- The current logs already point to the loss happening between raw LLM output and `validFacts`.
