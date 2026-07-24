## What's actually broken

Confirmed against the live DB — the current entries under Yumei include labels like:

- `Favorite restaurant` (still singular)
- `Favorite snack` (still singular)
- `Favorite TV show` (still singular)
- `Favorite Pokémon`, `Favorite hobbies`, `Favorite animals`, `Favorite mythical animals`, `Favorite avatar creators`, `Favorite colors`
- `Favorite McDonald's order` (has commas but is a single meal)

My previous change used a static `LIST_VALUED_LABELS` set to decide when to render bullets and when to pluralize. That set:

1. Doesn't contain the singular forms sitting in existing rows (so `Favorite restaurant`, `Favorite snack`, `Favorite TV show` render as blobs).
2. Doesn't contain novel labels the LLM invents (`Favorite Pokémon`, `Favorite mythical animals`, `Favorite avatar creators`, `Favorite colors`, `Favorite hobbies`, `Favorite animals`) — those render as blobs too.
3. Would falsely bullet-list `Favorite McDonald's order` if we naively lowered the bar to "any Favorite label".

A static allowlist cannot cover both existing data and future LLM-invented labels. The fix has to be presentation-layer and shape-based.

## Fix — presentation-only

All changes in the frontend. No DB migration, no edge-function change, no data mutation.

### 1. Render bullets based on VALUE SHAPE, not label allowlist

In `src/lib/profile-list-labels.ts`, replace `isListValuedLabel(label)` with `shouldRenderAsList(label, value)`:

- Return `false` for a hard denylist of "single fact with commas" labels: `Favorite McDonald's order`, `Go-to recipe`, `Current address`, `Previous address`, `Wedding location`, `Place of birth`, `Full name`, `Preferred name`, `Date of birth`, `Dietary style`, `Cooking skill level`, `Timezone`, `Job title`, `Employer`, `Height`, `Eye color`, `Hair color`, `Blood type`. (These are labels a natural-language value might contain commas in without meaning "multiple items".)
- Otherwise return `true` when `splitListValue(value).length >= 2`.
- Keep the known-list overrides (Nickname, Aliases, Skills, Hobbies, Allergies, …) as an allowlist that returns `true` even for single-item values, so a one-item list still renders as a bullet for consistency inside that label family. Optional; if it clutters single-item cases we skip it.

Update `CompactCategorySection.tsx` to call `shouldRenderAsList(entry.label, entry.value)` instead of `isListValuedLabel(entry.label)`.

### 2. Pluralize labels at display time

Existing rows have singular labels; the alias map only folds new writes. Fix presentation:

- Add `displayLabel(label)` in `src/lib/profile-list-labels.ts` — a small table mapping the singulars seen in DB to their plural display form:
  - `Favorite restaurant` → `Favorite restaurants`
  - `Favorite snack` → `Favorite snacks`
  - `Favorite TV show` → `Favorite TV shows`
  - `Favorite movie` → `Favorite movies`
  - `Favorite song` → `Favorite songs`
  - `Favorite music artist` → `Favorite music artists`
  - `Favorite character` → `Favorite characters`
  - `Favorite YouTuber` → `Favorite YouTubers`
  - `Favorite fruit` → `Favorite fruits`
  - `Favorite dessert` → `Favorite desserts`
  - `Favorite drink` → `Favorite drinks`
  - `Favorite food` → `Favorite foods`
  - `Favorite place` → `Favorite places`
  - `Favorite game` → `Favorite games`
  - `Favorite color` → `Favorite colors`
  - `Favorite animal` → `Favorite animals`
- Additionally: when a label is not in that map, if `shouldRenderAsList(label, value)` returns true AND the label ends in a singular common noun with a trivial plural (regex-based, guarded), still leave it alone — don't auto-mangle unknown labels. Keep this table explicit and small.
- `CompactCategorySection.tsx` renders `displayLabel(entry.label)` (and passes it to `Highlighted`); editing/saving still uses the raw stored label so nothing gets renamed at the DB.

### 3. Character title-casing (unchanged)

Keep `titleCaseCharacterName`, applied only when `entry.label` normalized === `favorite characters` (matches whether stored as "Favorite character" or "Favorite characters").

## Files touched

- `src/lib/profile-list-labels.ts` — replace `isListValuedLabel` with `shouldRenderAsList(label, value)`; add `displayLabel(label)`; keep `splitListValue`, `titleCaseCharacterName`, `isCharacterLabel`.
- `src/components/people/profile/CompactCategorySection.tsx` — use `shouldRenderAsList` for the render branch; render `displayLabel(entry.label)` in the label span (both in the header and inside the `Highlighted` component input).

## Out of scope

- No DB rename of existing rows. Storage stays as-is; the normalizer will still fold future writes toward the plural canonical.
- No LLM prompt change.
- Editing UX (EntryForm) is unchanged.
