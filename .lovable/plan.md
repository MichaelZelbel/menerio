# Fix "Add fact" on person profiles

## What actually happened with Yumei's email

Verified against the live database and edge logs:

- At 23:05:54 the classifier ran for your fact and returned a proposal (category "Communication Style", label "Email").
- No write ever followed. `normalize-profile` only logged its automatic cleanup passes at 23:06 / 23:10 — no `write_profile_entry` call. There is no row containing `hi14miau@gmail.com` anywhere in `profile_entries` or the review queue.

So nothing was saved. The quick-add box is a **two-step** control: first Enter classifies and shows a chip, a second Enter saves. The chip reads like a confirmation ("Communication Style · Email" + the value), so it looks finished when it is actually still a draft. That is the bug you hit.

Two more real defects found while tracing this:

- **Silent phantom saves.** When a database dedup trigger swallows an insert (it returns NULL instead of a row), the backend still reports `inserted` and the UI toasts "Entry saved" while nothing was written. Same failure mode you would have hit even if you had pressed Enter twice and the value collided with an existing row.
- **Duplicate category sections.** Yumei has two "Identity & Basics" and two "Communication Style" category rows (created 2026-05-19 and 2026-07-12). The profile renders one section per row, which is a large part of why the profile is hard to navigate.

## Where an email belongs

In the current 17-category taxonomy the contact-channel category is **Communication Style** — it already owns the canonical labels Email, Phone, Preferred channel, Social handle, Website. The classifier was right; the category *name* is wrong. It will be renamed to **Contact & Communication**, so email/phone obviously live there, and communication *style* facts stay welcome in the same place.

## What to build

1. **Make saving explicit and unmistakable.**
   - The proposal renders as a clearly unsaved draft: label it "Not saved yet — review and save", with visible **Save** and **Discard** buttons next to the chip (Enter still saves, Esc still discards).
   - After saving, show the destination in the toast: `Saved to Contact & Communication · Email`, and briefly highlight the new fact in its section.

2. **Never report a save that did not happen.**
   - In `normalize-profile`'s `writeProfileEntrySafely`, when the insert returns no row, re-query for the row that absorbed the value. If a row is found, return `absorbed` with its id; if nothing is found, return `ok: false` with an honest reason instead of `inserted`.
   - The hook surfaces the outcome: saved / added to an existing entry / not saved (with reason).

3. **Stop mangling emails, URLs and handles.**
   - The value tokenizer splits `hi14miau@gmail.com` into `hi14miau`, `gmail`, `com`, which lets subset/duplicate logic suppress or rewrite contact details. Emails, URLs and `@handles` will be treated as atomic tokens in both the SQL tokenizer and the shared TypeScript dedup helper.

4. **One section per category.**
   - Rename the `communication` category to "Contact & Communication" (schema + taxonomy + existing rows).
   - Merge duplicate category rows per (contact, slug): keep the oldest, move entries onto it, delete the empties. Add a unique index on (user_id, contact_id, slug) so duplicates cannot come back, and make `ensureProfileCategory` reuse instead of insert.

5. **Faster, cheaper classification for obvious facts.**
   - The deterministic pre-pass missed "Emails Address" (only "email address" is an alias), so it paid for a slow LLM round-trip. Alias matching becomes plural- and punctuation-tolerant, and an email/phone/URL-shaped value routes straight to its canonical label with no LLM call.

## Technical notes

- Frontend: `src/components/people/profile/QuickAddFact.tsx` (draft state + Save/Discard + outcome toast), `src/hooks/useContactProfile.ts` (outcome-aware toast), `src/lib/profile-categories.ts` (`ensureProfileCategory` reuse), `src/lib/profile-taxonomy.ts` (category rename).
- Backend: `supabase/functions/normalize-profile/index.ts` (`writeProfileEntrySafely` absorbed-row lookup), `supabase/functions/_shared/profile-canonical-schema.ts` (alias normalization, value-shape routing), `supabase/functions/classify-profile-fact/index.ts` (category display name, deterministic shortcuts).
- Migration: atomic-token fix in `profile_tokenize_value`, category rename, duplicate-category merge, unique index on (user_id, contact_id, slug).
- Tests: unit tests for atomic-token handling, alias tolerance ("Emails Address" → Email), and the absorbed-vs-not-saved outcome; a component test asserting the proposal is not treated as saved until Save is pressed.
- After the fix I will add your email to Yumei's profile through the UI and confirm the row exists in the database.
