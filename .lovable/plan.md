## Goal

Today, profile facts are only extracted from notes. Moments — which are explicitly tied to people via `moment_participants` and often capture life events — are invisible to the profile-suggestion pipeline. This plan wires moments into the same extraction pipeline (live + backfill) and surfaces a read-only "Life events from Timeline" view inside the Person profile so users can see, at a glance, what the timeline contributes.

## Part 1 — Moments as a profile-fact source (live)

### 1a. Shared extraction helper

Extract the moment→profile-suggestion logic so both the live path and the backfill use the same code.

- New file `supabase/functions/_shared/moment-profile-extraction.ts` exporting `extractProfileSuggestionsFromMoment(moment, participants, opts)`:
  - Builds a compact text blob: `title + description + happened_at + category + status`.
  - For each participant, calls the existing extraction prompt (reused from `process-note`) with a small adapter so it treats the moment as the source text.
  - Maps results to existing suggestion types:
    - life events → `add_profile_entry` (category `Milestones`)
    - locations → `add_profile_entry` (category `Places`)
    - roles/companies → `add_profile_entry` (category `Work`)
    - relationships mentioned → `add_relationship`
  - Also derives a soft `last_contact_date` signal from `happened_at` when `status='happened'` and the moment involves the user (skips for pure third-party events).
  - Confidence policy:
    - Full range when `moment_provenance` rows exist (document-backed).
    - Cap at `0.7` when `source='manual'` and no provenance.
  - Writes via the same `prepareSuggestionForInsert` + dedup paths used for notes, so the per-type `AUTO_APPLY_THRESHOLDS` already shipped apply automatically. No new knobs.

### 1b. Trigger live extraction

- New edge function `supabase/functions/extract-moment-profile/index.ts`:
  - Accepts `{ moment_id }`, loads the moment + participants, runs the shared helper.
  - `verify_jwt = false`, per-request auth client pattern (same as other functions).
  - Uses `EdgeRuntime.waitUntil` so the caller returns immediately.
- Invoke it from the existing client paths that create/update moments:
  - `src/components/timeline/AddEventDialog.tsx` — after insert/update.
  - `supabase/functions/extract-event/index.ts` and `draft-event/index.ts` — after they materialize a moment.
- Tag suggestions with `source = 'moment:<id>'` in `review_queue.payload.source` so Review Queue items are auditable and undoable.

### 1c. Dedup with note-derived suggestions

- Reuse existing `ai_suggestion_suppressions` + `suppression_key` logic. Use a `suppression_key` of `moment:<contact_id>:<category>:<normalized_value>` and also check the note-derived `note:` key so we don't surface the same fact twice.

## Part 2 — Backfill for existing moments

- New edge function `supabase/functions/backfill-moment-profile-extraction/index.ts`:
  - Body: `{ limit?: number = 200, contact_id?: string }`.
  - When `contact_id` is set, only iterates `moment_participants` for that person; otherwise iterates the user's recent ~200 moments.
  - Runs the shared helper per moment, throttled with a 150ms delay like the notes backfill.
  - Returns `{ scanned, triggered, skipped }`.
  - Uses `EdgeRuntime.waitUntil`.

- UI hooks (no new buttons unless necessary):
  - In `src/components/settings/ImportMigrate.tsx`, fold the moment backfill into the existing "Enrich profiles from past notes" action: a single button that fires both `backfill-profile-extraction` and `backfill-moment-profile-extraction` in parallel, with one combined toast.
  - In `src/components/people/ContactProfileTab.tsx`, the existing "Enrich from notes" button on the Person profile is renamed to "Enrich from notes & timeline" and triggers both backfills scoped to that `contact_id`.

## Part 3 — Reverse direction: "Life events from Timeline" inside the profile

Currently `PersonTimeline` is rendered as its own tab on the Person page. The profile tab itself has no awareness of moments. Add a compact, read-only strip at the top of `ContactProfileTab` so users see life-event signals from moments alongside the structured profile.

- New component `src/components/people/LifeEventsStrip.tsx`:
  - Queries the latest ~6 moments where this contact is a participant (`status in ('happened','planned')`, ordered by `happened_at` desc).
  - Renders a horizontally scrollable strip of small cards: date, title, optional category badge.
  - Each card links to `/dashboard/timeline?moment=<id>` (existing route).
  - "View all on Timeline" link to the Timeline tab.
  - Empty state: hidden entirely when the person has zero moments (no noise).

- Wire it at the top of `ContactProfileTab.tsx`, above `RelationshipsSection`.

- Pending-suggestion badge: extend the existing badge query in `ContactProfileTab` to also count suggestions tagged with `source` starting with `moment:`, so the user knows when timeline-derived facts are waiting in the Review Queue.

## Part 4 — Review Queue audit

- In `src/pages/ReviewQueue.tsx` and the per-item card, when `payload.source` starts with `moment:`, show a small "From timeline" chip with a link to the source moment. (Notes already show "From note: <title>" — mirror that pattern.)

## Files

New:
- `supabase/functions/_shared/moment-profile-extraction.ts`
- `supabase/functions/extract-moment-profile/index.ts`
- `supabase/functions/backfill-moment-profile-extraction/index.ts`
- `src/components/people/LifeEventsStrip.tsx`

Edited:
- `supabase/config.toml` — register the two new functions with `verify_jwt = false`.
- `supabase/functions/process-note/index.ts` — export the extraction prompt + `prepareSuggestionForInsert` for reuse (or move to `_shared`).
- `supabase/functions/extract-event/index.ts`, `supabase/functions/draft-event/index.ts` — invoke `extract-moment-profile` after persisting a moment.
- `src/components/timeline/AddEventDialog.tsx` — invoke `extract-moment-profile` after create/update.
- `src/components/settings/ImportMigrate.tsx` — combined enrich action.
- `src/components/people/ContactProfileTab.tsx` — render `LifeEventsStrip`, rename + extend enrich button, extend pending badge query.
- `src/pages/ReviewQueue.tsx` (and shared review-item card if present) — "From timeline" chip.

## Verification

1. Create a manual moment for `peter@pro.com` like "Sarah moved to Lisbon" with Sarah as participant → within seconds a `Places` profile suggestion appears (auto-applied or in Review Queue depending on confidence).
2. Run the combined backfill on the test account → expect new auto-applied entries on people with timeline activity, plus pending items in Review Queue for borderline cases.
3. Open Sarah's profile → `LifeEventsStrip` shows her recent moments; pending badge counts include `moment:*` suggestions.
4. Review Queue shows "From timeline" chip on moment-derived items, linking back to the moment.

## Out of scope

- No new DB schema (reuse `review_queue`, `profile_entries`, `ai_suggestion_suppressions`).
- No changes to AI Chat / MCP — moments already feed those.
- No new sensitivity controls; the existing `AUTO_APPLY_THRESHOLDS` apply.
