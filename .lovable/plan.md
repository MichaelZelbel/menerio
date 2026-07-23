## What I verified

- The current frontend source does have an automatic normalization call in `PersonDetail.tsx`, but it is guarded by a 6-hour `localStorage` cooldown.
- That call sends `action: "backfill"`, and `normalize-profile` immediately returns `202 started` while the actual work runs later via `EdgeRuntime.waitUntil`.
- The frontend then records the cooldown after the `202`, not after actual cleanup. So a started-but-failed/no-op run can suppress future attempts.
- The preview/network snapshot shows no `normalize-profile` request for the current open of Yumei.
- Recent edge/function logs show no `normalize-profile` invocation.
- Live data still has the problem: Yumei has 207 profile entries, 11 BPD mentions, 15 health-related rows, and 17 historical `normalize_profile_entry` rows marked `kept`.

## Root problem to fix

The automatic cleanup is not reliable because it is browser-local, fire-and-forget, and not verified against actual database changes. It also has no server-side run state, so the app cannot know whether Yumei was actually cleaned or merely that a request once returned “started”.

## Plan

### 1. Make contact normalization synchronous and observable

Change `supabase/functions/normalize-profile/index.ts` so:

- `scope: "contact"` runs immediately and awaits completion before returning.
- It returns real counts: planned groups, applied groups, created review items, skipped/stale groups, and any errors.
- `scope: "all_contacts"` can still use background execution, because that is the only potentially long-running path.
- The frontend must not record any cooldown unless the response says the contact run actually completed.

This removes the current “request started, maybe nothing happened” failure mode.

### 2. Move cooldown/state from `localStorage` to the server

Add a small `profile_normalization_runs` table:

- subject owner/contact
- last input hash
- last run time
- status: `running`, `completed`, `failed`
- counts and error message

Access rules:

- Users can read their own run state.
- Edge functions can update run state with the service role.

The normalizer will compute a hash of the current profile entries. If the profile content changed since the last completed run, it runs again automatically. If not, it skips safely. This replaces brittle browser-local cooldowns.

### 3. Trigger normalization from the profile data hook, not the page shell

Move the automatic call out of `PersonDetail.tsx` and into the profile data path (`useContactProfile` or `ContactProfileTab`) after entries/categories load.

Why:

- It guarantees the trigger is tied to the actual profile data the user is seeing.
- It can compare the profile-entry hash/run state.
- It avoids hidden page-mount timing issues.

After a completed run, invalidate exactly:

- `contact-profile-entries`
- `contact-profile-categories`
- pending profile suggestions
- review queue

No button, no user maintenance step.

### 4. Make safe deterministic cleanup apply directly

In `_shared/profile-normalization.ts`, split output into two classes:

- **Safe deterministic cleanup**: exact duplicates, checkbox-style `BPD: true`, alias relabels, list-valued union merges.
- **Human review cleanup**: conflicting single-value facts, lossy/mixed-field groups, low-confidence LLM suggestions.

For safe deterministic cleanup:

- Apply directly to `profile_entries`.
- Log a `review_queue` audit row after applying if useful, but do not depend on the review queue insert for the data cleanup to happen.

For human review cleanup:

- Create `pending_review` rows only.

This prevents old/historical queue rows from blocking obvious database cleanup.

### 5. Harden the health/BPD canonicalization specifically

Extend the deterministic normalizer so Yumei’s current rows collapse reliably:

- Convert `BPD: true` into `Health conditions: BPD`.
- Canonicalize `Diagnosis`, `Diagnoses`, `Medical condition`, `Mental health condition(s)`, and `Health conditions` into one list-valued health field unless the row is specifically an allergy/medication.
- Deduplicate abbreviation/full-name pairs:
  - `BPD` = `borderline personality disorder`
  - `MDD` = `major depressive disorder`
  - `ASD` = `autism spectrum disorder`
  - `AVPD` = `avoidant personality disorder`
- Split health/allergy lists on commas, slashes, `and`, `or`, and German equivalents, while preserving distinct conditions.
- Keep allergies separate as `Allergies` when the row is clearly allergy-only.

Expected result: BPD should appear once in the canonical health row, not scattered across many rows.

### 6. Add tests for the exact failure case

Add focused edge/shared-module tests using a Yumei-like fixture:

- `BPD: true`
- `Mental health condition: BPD`
- `Medical condition: MDD, BPD, ASD, AVPD`
- `Mental health conditions: Major depressive disorder, borderline personality disorder, autism spectrum disorder, avoidant personality disorder`
- allergy rows such as `allergic to Buscopan or Postan`

Assertions:

- One canonical health-condition row is produced.
- BPD appears once after synonym normalization.
- Allergy rows are either separated or deduped correctly.
- Conflicting singleton fields still go to review, not auto-apply.

### 7. Redeploy and run the repair automatically for Yumei

After implementation:

- Deploy `normalize-profile` and any shared files it imports.
- Invoke the deployed `normalize-profile` function for Yumei from here, not by asking you to click anything.
- Query the live database after the run and report raw counts:
  - total profile entries
  - BPD mentions
  - health-related rows
  - any pending normalization rows

### 8. Verification before saying it is fixed

I will only call this fixed after verifying all of these:

- The deployed edge function logs show a real `normalize-profile` contact run.
- The function response reports completed counts, not just `started: true`.
- Live DB rows for Yumei changed.
- BPD duplicate mentions are collapsed.
- Re-opening Yumei’s profile triggers no redundant run if the server-side input hash is unchanged.
- Adding a new duplicate fact triggers a new run automatically without any user click.

## Files likely touched

- `supabase/functions/normalize-profile/index.ts`
- `supabase/functions/_shared/profile-normalization.ts`
- `supabase/functions/_shared/profile-canonical-schema.ts`
- `src/hooks/useContactProfile.ts` or `src/components/people/ContactProfileTab.tsx`
- remove the current auto-normalization effect from `src/components/people/PersonDetail.tsx`
- new migration for `profile_normalization_runs`
- focused tests for the normalizer fixture