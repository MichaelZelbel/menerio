
## Problem

Your dedup for profile-entry suggestions compares `(contact_id, label_lower, normalized_value)` exactly. That works when the same phrase reappears verbatim, but it doesn't catch the pattern that's actually filling your queue — list-valued facts written as **different combinations of the same tokens**. Live data from Yumei right now:

- **Health conditions** — 6 competing rows: `"MDD"`, `"BPD"`, `"ASD"`, `"AVPD"`, `"MDD, BPD, ASD, AVPD"`, `"MDD, BPD, ASD, AVPD, panic attacks"`, `"MDD, BPD, ASD, AVPD, panic attacks, endometriosis"`. Every new note reshuffles the list and produces a "new" value string.
- **Favorite food** — `"Sushi, KFC, McDonald's"` vs `"Sushi, KFC, McDonald's, Starbucks strawberry frappuccino, Hello Kitty strawberry milkshake, pão recheado"`. Superset regenerated as a fresh suggestion.
- **Allergies / Health conditions overlap** — `Allergies: "Allergic to Buscopan/Postan"` and `Health conditions: "Endometriosis, allergic to Buscopan/Postan"` — same fact leaked into two labels.

The normalizer cleans this up after the fact, then the extractor regenerates it on the next note. We need to stop it at the write.

## Fix — token-level containment guard before insert

Two extractors write these rows: `supabase/functions/process-note/index.ts` (note → facts) and `supabase/functions/_shared/moment-profile-extraction.ts` (timeline moment → facts). Both build the same `entrySet` / `queueSet` of exact keys. Replace that check with a token-aware one, sharing the logic from `_shared/profile-normalization.ts` (`splitListTokens`, `normalizeTokenForList` already exist there).

### 1. New shared helper: `_shared/profile-dedup.ts`

- `isListValuedLabel(canonicalLabel)` — returns true for labels the schema marks `single: false` **and** the small set of known list fields (`Health conditions`, `Allergies`, `Favorite food`, `Favorite drink`, `Favorite movies`, `Favorite TV shows`, `Hobbies`, `Skill`, `Nickname`, `Nationality`, `Child`, `Parent`, `Sibling`, `Previous employer`, `Previous city`, `Previous address`, `Social handle`, `Email`, `Phone`, `Website`, `Certification`, `Degree`, `Field of study`, `School`). Drives whether we split-and-compare instead of exact-compare.
- `buildExistingTokenIndex(existingEntries, existingQueueRows)` — returns a `Map<contactKey|labelGroup, Set<normalizedToken>>` where `labelGroup` collapses semantically-identical labels into one bucket (e.g. `favorite food`, `favorite restaurant`, `favorite fast food`, `favorite drink` all map to bucket `food:favorite`; `allergies` and `health conditions` both contribute their allergy tokens to a shared `health:allergy` bucket via a phrase test on tokens containing `allerg`). Uses the canonical schema aliases already in `profile-canonical-schema.ts` for the primary grouping; the small extra rules above cover the specific overlaps we see today.
- `dedupIncomingValue({ contactId, label, value, index })` — returns `{ action: "skip" } | { action: "write", value } | { action: "write", value: newTokensJoined }`:
  - Non-list label → exact behavior (same normalized-value compare as today).
  - List label → split incoming value into tokens; drop any token whose normalized form is already in the index bucket; if all are known → **skip**; if some remain → rewrite the suggestion's `value` to just the residual tokens joined with `", "` so the queue item represents only the genuinely new facts. Update the index in memory so later facts in the same batch dedup against it.

### 2. Wire it into both extractors

In `process-note/index.ts` around lines 1503–1594 and in `moment-profile-extraction.ts` around lines 447–562:

- Replace the manual `entrySet` / `queueSet` / `singletonEntrySet` construction with a single call to `buildExistingTokenIndex` (it still enforces the singleton rule internally by treating `single: true` labels as an atomic bucket).
- Replace the `if (entrySet.has(dedupKey) || queueSet.has(dedupKey)) continue;` gate with `dedupIncomingValue(...)` and act on its return value.
- Keep the existing suppression/preferences path untouched.

### 3. Small post-hoc safety net in the normalizer

In `_shared/profile-normalization.ts`, extend the deterministic collapser that already runs before the LLM: for list-valued labels within one contact + label bucket, if entry A's token set is a strict subset of entry B's, mark A for removal (merge into B). Today the collapser only handles exact-normalized duplicates; this adds subset collapse so any residual duplicates that slip past the write guard still get cleaned in the next scheduled `admin-normalize` cron pass without generating a `normalize_profile_entry` review item.

### 4. Verification (post-implement)

1. Re-trigger `process-note` on the last note that produced the current 65 items and confirm zero new duplicates for `Health conditions` / `Favorite food`.
2. Run `admin-normalize` for Yumei; confirm the collapse pass folds `"MDD"`, `"BPD"`, `"ASD"`, `"AVPD"` into the existing combined list without creating review items.
3. Unit tests in `src/lib/__tests__/` covering: subset skip, partial-overlap rewrite, allergy cross-label bucket, single-token new fact, non-list label unchanged.

## Out of scope

- Merging genuinely-different label variants owned by different categories (e.g. `Favorite fast food` under `hobbies` vs `Favorite restaurant` under `food`) — the bucket rule handles the dedup, but I won't re-home the label; that stays a normalizer decision.
- Changing confidence thresholds or the auto-apply gate.
- Frontend changes.

## Files touched

- `supabase/functions/_shared/profile-dedup.ts` — new
- `supabase/functions/process-note/index.ts` — dedup block only
- `supabase/functions/_shared/moment-profile-extraction.ts` — dedup block only
- `supabase/functions/_shared/profile-normalization.ts` — extend deterministic collapser with subset rule
- `src/lib/__tests__/profile-dedup.test.ts` — new (tests import the shared module directly)
