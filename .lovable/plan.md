## Problem

Profile extraction is producing nonsensical, conflicting facts (e.g. four different "Job title" values for Nate Jones) from Querino-synced prompt notes where Nate appears only as the author/byline. Three concrete weaknesses cause this:

1. **Prompt is too permissive.** `PROFILE_EXTRACTION_PROMPT` does not distinguish "person *mentioned as author/source/byline* of the note" from "person *being described* by the note". On a prompt-library note, the LLM treats the prompt's stated role as Nate's job title.
2. **Source is ignored.** External / web-clip notes (Querino, GitHub, SingleFile, etc.) are third-party content, not first-person observations — they should be excluded from biographical extraction.
3. **No singleton-label dedupe.** A contact can accumulate many parallel Job title / Current city / Company values in the queue because dedupe keys on `(contact, label, value)` instead of `(contact, label)` for single-value labels.

## Changes — `supabase/functions/process-note/index.ts`

### 1. Tighten the extraction prompt

Rewrite `PROFILE_EXTRACTION_PROMPT` to explicitly forbid extracting facts when the person appears as:
- author / byline / source / "via X" / link metadata
- subject of a third-party article, prompt, podcast, video, etc.
- a generic mention without first-person attribution

Add a short contrast example in the prompt:
- ✓ "Nate works as a knowledge architect at Acme." → `{contact: Nate, label: Job title, value: knowledge architect at Acme}`
- ✗ "OB1-Wiki Prompt 3: Wiki Synthesis Agent — by Nate Jones." → no facts (Nate is the author, the role belongs to the prompt).

Also require: extract a `Job title`, `Company`, `Current city`, etc. only when the note text contains a clear "X is/was/works as Y" or "X's role is Y" construction. Otherwise return no fact for that label.

### 2. Skip profile extraction for non-personal sources

Inside `runProfileExtraction` (called from `generateReviewItems`), short-circuit when the note is from a source that is structurally not first-person observation:
- `is_external = true`
- `source_app ∈ {querino, github, singlefile, slack-public-channel, web-clip}` (configurable allowlist)
- metadata `type` indicates `prompt`, `template`, `article`, `documentation`

Personal sources (`telegram-capture`, `discord-capture`, manual notes, voice notes, conversation chat) continue to extract.

Log a single line `[profile-extract] skipping note <id>: source=<source_app> not first-person` so behaviour is observable.

### 3. Singleton-label dedupe

Define a small set of `SINGLETON_PROFILE_LABELS` (case-insensitive): `job title`, `current job title`, `role`, `company`, `current company`, `employer`, `current city`, `location`, `birthday`, `pronouns`, `nationality`, `partner`, `spouse`.

When building suggestions:
- Extend `entrySet` and `queueSet` to also store `contact_id|label` (no value) for these labels.
- Skip a new fact if a pending/accepted suggestion (or existing entry) already exists for the same `(contact, label)`. The user can edit the existing suggestion or delete the entry to make room for a new one.

This caps Nate's profile to a single pending Job title at any time.

### 4. Soft cap on facts per (note, contact)

Add a hard limit of `MAX_FACTS_PER_CONTACT_PER_NOTE = 3` to the post-parse filter, sorted by category importance (identity → professional → location → others) so a single chatty note can't flood the queue.

## Cleanup of existing bad suggestions (one-off)

Add a small script-style migration (or admin tool — out of this plan if user prefers) that:
- Marks all pending `add_profile_entry` items where `payload.contact_id = Nate's id` and `payload.label` ∈ singleton labels as `dismissed` with reason `"superseded — duplicate"`, keeping only the highest-confidence one.

For now we just delete them via a one-off SQL action the user can trigger after the fix lands; the new dedupe will then prevent re-creation. The user can also just hit "Never Again" / "Roll Back" in the UI on what's there.

## Verification

- Re-run process-note on one of the four Querino prompts (`0d981bdd-…`) → log shows `skipping note … source=querino not first-person`, no new `add_profile_entry` rows.
- Manually create a note "Nate Jones is a knowledge architect at Acme." → still produces one Job title suggestion.
- Trigger the same fact twice → second insert is suppressed by `(contact, label)` dedupe.

## Out of scope

- Changing `metadata.people` extraction itself (that's `extract-event` / quick-capture logic — Nate legitimately appears in the text).
- UI changes to the Review Queue.
- Backfill / mass-clean of the existing nonsense suggestions beyond a one-off SQL purge after deploy.
