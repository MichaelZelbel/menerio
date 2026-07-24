## Goal

Fix three UI/data issues visible on Yumei's profile (and every other profile) in the Food & Drink and Music & Entertainment sections:

1. Inconsistent label pluralization ("Favorite restaurant" vs "Favorite characters").
2. Comma-separated blobs are unreadable — should be one item per line.
3. "Favorite characters" values are all-lowercase — names should be capitalized.

## 1. Consistent plural labels for list-valued fields

Any label that is `LIST_VALUED` semantically holds multiple items and should read in plural. Update `supabase/functions/_shared/profile-canonical-schema.ts`:

- Rename canonical forms and add aliases so old singular labels fold into the new plural canonical:
  - `Favorite restaurant` → `Favorite restaurants`
  - `Favorite snack` → `Favorite snacks`
  - `Favorite dessert` → `Favorite desserts` (already list-valued)
  - `Favorite drink` → `Favorite drinks`
  - `Favorite food` → `Favorite foods`
  - `Favorite fruit` → `Favorite fruits`
  - `Favorite song` → `Favorite songs`
  - `Favorite movie` → `Favorite movies`
  - `Favorite show` / `Favorite TV show` → `Favorite TV shows`
  - `Favorite series` → `Favorite series` (unchanged, invariant plural)
  - `Favorite music artist` → `Favorite music artists`
  - `Favorite character` → `Favorite characters`
  - `Favorite YouTuber` → `Favorite YouTubers`
  - `Favorite game` → `Favorite games` (already handled)
  - `Favorite place` → `Favorite places`
  - `Favorite McDonald's order` → keep singular (single-order concept, not a list)
  - `Go-to recipe` → keep singular
- Add each new plural to `LIST_VALUED_LABELS`.
- Add old-singular → new-plural entries to `OPEN_CATEGORY_LABEL_ALIASES` so the normalizer folds existing rows on the next pass.

## 2. One-item-per-line rendering for list-valued values

Change how comma-separated values render in the contact profile, without changing storage (values stay stored as `"a, b, c"` — the DB dedup/normalizer logic already depends on that shape).

In `src/components/people/profile/CompactCategorySection.tsx`, split rendering by label type:

- Import a small helper `isListValuedLabel` (mirror the server-side set client-side in `src/lib/profile-taxonomy.ts` or a new `src/lib/profile-list-labels.ts` so we don't import from `supabase/functions/`).
- For entries whose canonical label is list-valued, render the value as a `<ul>` with one `<li>` per comma-split token (trimmed, empties dropped), each on its own line, with a subtle bullet or dash. Preserve the search highlight per item.
- For non-list entries, keep the current inline single-line rendering.
- Editing (`EntryForm`) still shows the raw comma-joined text — no change to input UX in this pass.

## 3. Capitalize items in "Favorite characters"

Capitalization is a presentation concern here — the raw text from notes is lowercased by the LLM pipeline. Two-part fix:

- **Display-side (immediate):** in the new list renderer, when the entry's canonical label is `Favorite characters`, apply a Title-Case transform per list item at render time (capitalize the first letter of each word; leave tokens that already contain an uppercase letter untouched so brand-style names like `d3r` or `6arelyhuman` in other fields aren't affected — but this rule only fires for `Favorite characters`, so those aren't at risk anyway).
- **No mutation of stored values** in this pass. This keeps the change safe and reversible; if we later want persisted capitalization, we can add a one-shot backfill.

Do NOT apply title-casing globally to all list values — it would wrongly capitalize song titles, band names, and stylized handles elsewhere.

## Files touched

- `supabase/functions/_shared/profile-canonical-schema.ts` — canonical renames, alias additions, LIST_VALUED_LABELS additions.
- `src/lib/profile-list-labels.ts` (new, small) — client-side mirror of the list-valued label set + `isListValuedLabel` + `titleCaseCharacterName` helper.
- `src/components/people/profile/CompactCategorySection.tsx` — split value renderer: list vs inline; apply character-name title-casing only for `Favorite characters`.
- `src/lib/__tests__/profile-list-labels.test.ts` (new) — unit tests for `isListValuedLabel` and the title-case helper (leaves mixed-case tokens alone, capitalizes plain lowercase names, handles multi-word names like `geum seong je` → `Geum Seong Je`).

## Out of scope

- No DB migration / no rewrite of existing stored values. Old singular-labeled rows fold to the new plural canonical the next time the normalizer runs on that profile (existing mechanism).
- No changes to the LLM extraction prompts.
- No global title-casing across other fields.
