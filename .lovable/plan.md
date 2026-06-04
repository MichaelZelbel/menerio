## Diagnosis

I checked your account (`208 notes`, `165 contacts`) and found the smoking gun:

- You have **77 profile-fact suggestions** generated from notes, but only **17 entries** actually landed in contacts' profiles.
- Your AI suggestion preferences are: `mode=auto`, `sensitivity=conservative`, `auto_add_sensitive=true`.
- The `conservative` threshold is **0.85**, but the default confidence for `add_profile_entry` is **0.74**. That means **profile facts can literally never auto-apply for you** — every single one is forced into the Review Queue, where most sit as "kept" without ever being written to the profile.

On top of that:
1. `MAX_FACTS_PER_CONTACT_PER_NOTE = 3` caps how many facts can be extracted per note.
2. The extraction prompt is very strict (requires explicit first-person statements like "X is a Y at Z"), so plausible facts in narrative notes get dropped.
3. There's no way to re-mine past notes — only newly-ingested notes go through extraction, so your backlog of 208 notes never gets re-analyzed when the rules change.
4. Several sources (`querino`, `github`, `singlefile`, web clips) are blanket-skipped as "non-biographical", even when they contain real biographical content.

Result: it feels like nothing ends up in profiles, because for your settings, nothing does.

## Plan

### 1. Per-suggestion-type confidence policy (`process-note/index.ts`)

Profile entries are low-risk and easy to undo, so they shouldn't share the same threshold as creating new contacts.

- Introduce `AUTO_APPLY_THRESHOLDS` keyed by suggestion type:
  - `add_profile_entry`: conservative=0.78, balanced=0.65, exploratory=0.5
  - `add_relationship`: conservative=0.80, balanced=0.7, exploratory=0.55
  - `add_alias`: keep current (it changes identity)
  - `add_contact`: stays manual (already the case)
- Raise `DEFAULT_CONFIDENCE.add_profile_entry` from `0.74` → `0.80` so high-quality facts clear `conservative` automatically.
- Update `prepareSuggestionForInsert` to use the per-type threshold.

### 2. Loosen the per-note cap

- Bump `MAX_FACTS_PER_CONTACT_PER_NOTE` from 3 → 8. Keeps a guardrail against floods, but lets a meaty meeting note actually populate a profile.

### 3. Relax the extraction prompt

- Edit `PROFILE_EXTRACTION_PROMPT` to allow facts when the note clearly describes the person in third person ("Sarah just moved to Lisbon"), not only "explicit first-person statements". Keep the hard rules against authorship/bylines and prompt/article topic-as-attribute.
- Remove the unconditional "drop malformed birthday" silent skip; instead, keep the fact with `category=identity, label=Birthday, value=<raw>` when we can't derive a full ISO date, so the user at least sees the suggestion.

### 4. Stop blanket-skipping `singlefile` / `github` / `querino`

- Replace `NON_BIOGRAPHICAL_SOURCES` blanket skip with a **soft signal**: still run extraction, but cap confidence at `0.7` for those sources so they require user review under conservative. Keep the metadata-`type` skip for `prompt`/`template`/`code`/`snippet`.

### 5. Backfill action: "Enrich profiles from past notes"

New button in **Settings → AI** (and on the Person detail's profile tab):

- Calls a new edge function `backfill-profile-extraction` that:
  - For a given `user_id` (and optional `contact_id` filter), iterates recent ~200 notes that haven't been re-scanned with the new rules.
  - For each note, re-runs the matched-people + profile-fact extraction pipeline (reusing `generateProfileSuggestions`).
  - Respects existing dedup logic (won't create duplicates).
  - Returns counts (`scanned`, `new_suggestions`, `auto_applied`).
- UI shows a progress toast and a "X new suggestions, Y added to profiles" result.

### 6. Visibility nudge in the UI

- Add a small badge on the People list and on each Person header: **"N profile suggestions pending"**, linking to the Review Queue filtered to that person. So even when something needs review, you can't miss it.

### 7. Backfill the analytics

After the changes ship, run the new backfill once for your account so the existing 208 notes get re-processed under the new rules.

## Technical details

Files to change:
- `supabase/functions/process-note/index.ts` — thresholds, default confidence, prompt, cap, soft-signal sources, malformed birthday handling.
- `supabase/functions/backfill-profile-extraction/index.ts` — **new** edge function.
- `src/components/settings/` — new "Enrich profiles" button (next to existing backfill controls).
- `src/components/people/ContactProfileTab.tsx` / `People.tsx` — pending-suggestions badge + per-person enrich trigger.
- `src/hooks/useReviewQueue.ts` — small helper to count pending profile suggestions per `contact_id` for the badge.

No DB schema changes needed; everything reuses existing `review_queue`, `profile_entries`, `profile_categories`, `ai_suggestion_preferences`.

## Verification

1. Run the backfill on `peter@pro.com`/the main account.
2. Confirm `profile_entries` count for contacts grows significantly (expect dozens of new auto-applied entries).
3. Confirm the Review Queue shows only the genuinely ambiguous cases.
4. Open a few Person pages and confirm Identity/Location/Professional fields are now populated where the notes contain the info.
