# Profile duplicate prevention — proof-driven fix

## 1. Live diagnostic (already run, contact_id=cf9b5d76 "Yumei", 134 entries)

Concrete duplicate clusters found in the live database:

**Exact same (label, value):**
- `Moved out at age` / `Age moved out` = "16"
- `Japanese name` / `Full name (Japanese)` = "Yumei"
- `Brazilian name` / `Full name (Brazilian)` = "Yasmin"
- `VRChat identity` / `VRChat persona` = "Puppy/kitty/princess aesthetic, internet angel, semi/non-verbal, very sensitive"
- `VRChat avatar creators` / `Favorite avatar creators` = "angelcore.club, Awo's Bakery, Yura"

**Same label, list value where one row's tokens ⊆ another:**
- `Favorite artists` ⊇ `Favorite musician / band` ⊇ `Favorite music artists` ⊇ `Favorite music`
- `Favorite food` ⊇ `Favorite foods and drinks` ⊇ `Favorite fast food` ⊇ `Favorite restaurant` (KFC/McDonald's)
- `Favorite games` ⊇ `Comfort game`
- `Favorite movies` ⊇ `Favorite movie` ⊇ `Comfort movie` (all → Grease)
- `Health conditions` ⊇ `Mental health diagnoses` ⊇ `Physical condition` ⊇ `Suspected condition`
- `VRChat equipment` ≈ `VRChat setup` ≈ `VRChat activities` ≈ `VR equipment` ≈ `VRChat hobbies` ≈ `Full body tracking:Yes`
- `Hobbies` ⊇ `VRChat hobbies`

**Same value on a paraphrased label:**
- `Hospitalization history` ≈ `Medical history` ≈ `Health conditions` (all "hospitalized as a child for mental health")

**Same-label, semantically conflicting (must NOT auto-merge → Review Queue):**
- `Favorite restaurant` = "KFC" vs `Favorite restaurant` = "McDonald's"
- `Favorite characters` (Alice-in-Borderland set) vs `Favorite characters` (Nekopara set)
- `Routine` = "Cleans house in morning" vs `Routine` = "Wakes up around 5 AM" (complementary, keep both)

## 2. Duplicate invariant (code definition)

Two rows `A`, `B` on the same `(user_id, contact_id)` are **safe to collapse** into the row with the more complete value when ALL hold:

1. `canonical(A.label) == canonical(B.label)` (via `canonicalLabelMap` + slug-normalize: lowercase, strip punctuation, collapse whitespace, singular).
2. Either:
   - `norm(A.value) == norm(B.value)` (exact after normalize), OR
   - `tokens(A.value) ⊆ tokens(B.value)` OR vice versa, where `tokens(v) = split(v, /[,;/·•]|\s(?:and|&|\+)\s/)` → lowercase → strip stopwords/punctuation.
3. Neither row is `is_pinned`.

Rows are **conflicting** (→ Review Queue, never auto-delete) when:
- Same canonical label but token sets have non-empty symmetric difference AND neither is a subset (e.g. KFC vs McDonald's for `Favorite restaurant`).
- Different labels but overlapping value tokens ≥ 50% (e.g. `Personality traits` vs `Semi-verbal:true`) — merge suggestion goes to review.

## 3. Deterministic write-time prevention

- **DB unique index** (partial, case-insensitive): `UNIQUE (user_id, contact_id, lower(btrim(label)), lower(btrim(value)))` on `profile_entries`. Prevents the trivial "insert exact clone" path that produced 5 of the clusters above.
- Change every insert site to `upsert(..., { onConflict: 'user_id,contact_id,label_norm,value_norm' })` via a generated columns `label_norm`, `value_norm` (`lower(btrim(...))`) so we don't fight PostgREST on expression indexes.
- Add pre-insert `resolveProfileWrite()` helper in `_shared/profile-dedup.ts` that:
  1. Canonicalizes label.
  2. Fetches existing rows for `(contact_id, canonical_label)`.
  3. If new value is a subset of any existing → skip write (log).
  4. If new value is a superset → UPDATE existing row's value in place.
  5. If exact match → skip.
  6. If conflicting → insert AND enqueue `review_queue` item of type `merge_profile_entries`.
- Wire this helper into all 5 write sites: `process-note`, `moment-profile-extraction`, `user-profile`, `generate-profile-suggestions`, `enrich-person-from-lexicon`.

## 4. Deterministic cleanup (DB-side, no LLM, no timeout)

New SQL function `public.cleanup_profile_duplicates(_user_id, _contact_id)` that, for each `(canonical_label)` group:
1. Deletes exact-value duplicates keeping oldest `created_at`.
2. Deletes rows whose token-set is a strict subset of another row in the group; retained row's `updated_at` bumped.
3. For different-label groups that share canonical label, folds into the canonical label.
4. For token-conflicting pairs (rule 2 fails), inserts a `review_queue` row with both ids and returns without deleting.
5. Returns `jsonb` summary: `{merged, deleted, review_created, remaining}`.

Called from:
- `admin-normalize` scheduled cron (already exists, currently runs LLM path).
- New action `POST /normalize-profile { action: 'deterministic_cleanup', contact_id }`.
- Automatically after every `resolveProfileWrite()` on that `(contact_id, canonical_label)`.

## 5. Tests (Vitest)

`supabase/functions/_shared/__tests__/profile-dedup.test.ts` extended with Yumei-style fixtures:
- `VRChat setup` vs `VRChat equipment` (same value, diff label) → merge into canonical `VRChat setup`.
- `Favorite food` (superset) vs `Favorite fast food` (subset) → keep superset.
- `Favorite restaurant: KFC` vs `Favorite restaurant: McDonald's` → NO merge, review queue item created.
- `Health conditions` (long list) vs `Mental health diagnoses` (subset) → merged.
- `Semi-verbal:true` vs `Personality traits:"...semi-verbal..."` → review suggestion, not auto-merge.

## 6. Proof

Sequence I will run and paste back verbatim:
1. `SELECT count(*), label, value ... WHERE contact_id=cf9b5d76 ...` (before, already have 134).
2. Deploy migration + edge functions.
3. `SELECT public.cleanup_profile_duplicates('4332607c-...', 'cf9b5d76-...');` — paste jsonb output.
4. Re-run the count query — paste after.
5. `SELECT ... FROM review_queue WHERE target_entity_id='cf9b5d76-...' AND suggestion_type='merge_profile_entries'` — paste the ambiguous items that were preserved for review.

If step 3 does not visibly shrink the duplicate clusters listed in §1, I stop and report what's blocking rather than declaring victory.

## Technical details

- Migration adds two generated columns + unique index + `cleanup_profile_duplicates` SQL function + `merge_profile_entries` allowed value in review_queue.
- `_shared/profile-dedup.ts` gets `resolveProfileWrite`, `canonicalLabelKey`, `tokenizeListValue`, `subsumes`, `conflicts`.
- The LLM path in `admin-normalize` stays as an opt-in `mode: 'llm'` but is no longer the default; deterministic cleanup is the default and runs synchronously.

---

Acceptance = §6 outputs prove clusters in §1 collapsed and conflicts sent to review.

Approve and I execute; the plan is intentionally scoped to what SELECT-provable behaviour requires.
