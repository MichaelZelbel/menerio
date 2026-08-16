# Honest answer first: No — not 100% yet

The closed-vocabulary trigger only catches labels that are in a **hand-written synonym list**. Anything outside that list is not recognized as a duplicate — it becomes a "New profile field" suggestion in your review queue, which silently makes *you* the duplicate checker. That is exactly what you don't want, and it is a gap, not a success.

There is currently **no fuzzy matching, no semantic matching, and no cross-label value check** when a new label appears. "Second job" / "Additional work" / "Other occupation" were only stopped because someone typed those three strings into a list.

# Fix: never ask the user about duplicates

## 1. Deterministic near-duplicate resolver (database, runs on every write)

Before any label is accepted, it is matched against every label that already exists for that person and every canonical label in the registry, using:

- normalized form (lowercase, punctuation stripped, plurals/stopwords removed, word order ignored)
- trigram similarity (`pg_trgm`) above a strict threshold
- token-overlap on meaning-bearing words ("second job" vs "other occupation" → both reduce to occupation tokens)

A match rewrites the label to the existing one and merges the values. No review item is created.

## 2. Value-first collapse (catches labels that differ but say the same thing)

If the incoming value is identical to, or a subset of, a value already stored on the same person in the same category, the write is absorbed into the existing entry regardless of the label — the existing label wins. This kills "Second job: Private bakery service" / "Additional work: Private bakery service" even if step 1 misses the wording.

## 3. LLM adjudication only for the residual, and only server-side

If steps 1 and 2 find no match, the extractor makes one cheap call that receives the full list of labels already used for that person plus the canonical registry, and must answer either "this is label X" or "genuinely new field". The user is never asked.

## 4. What actually reaches the review queue

Only labels that survive all three gates — i.e. genuinely new concepts. The queue never contains a question of the form "is this a duplicate?". Keep = the field exists; Rollback = discarded.

## 5. Retroactive cleanup

A background sweep runs the same resolver over all existing profile entries, merging duplicate label clusters and collapsing duplicated values, so profiles that are already messy get repaired without manual work.

## Technical notes

- Enable `pg_trgm`; add `public.profile_resolve_label(_user_id, _contact_id, _category, _label)` returning the label to use, called from `profile_entry_canonicalize` before the existing canonical/registry logic.
- Extend `profile_entries_prevent_duplicate_fact` with cross-label, same-category value containment.
- `_shared/profile-fields-registry.ts` gains `resolveLabel()` so `process-note`, `normalize-profile` and `review-queue-bulk` all share one resolution path.
- Sweep implemented as a background action on `normalize-profile` using `EdgeRuntime.waitUntil`, batched per contact.
- Verification: query live rows for Yumei and the owner profile after the sweep and confirm zero near-duplicate label clusters remain, plus a regression test set of the known bad pairs.
