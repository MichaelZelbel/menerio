# Profile Quality Overhaul

Five fixes, all rooted in the same cause: the extraction LLM is allowed to invent labels and duplicate facts across two storage systems, with no guardrails on what belongs in a profile.

## 1. Relationships: one section, one source of truth

Today the same fact lives twice: as `profile_entries` rows in the "Relationships & Family" category (`Spouse`, `Partner`, `Relationship status`) and as edges in `contact_relationships` rendered by the separate Relationships section. Nothing syncs them, which is why Xihui shows "status: wife", "Partner: Rick", "Spouse: Michael" alongside a correct edge list (partner/spouse Michael, lover Rick, friend Lucy).

**Decision: `contact_relationships` is the single source of truth for who-is-who.**

- Add `Spouse`, `Partner`, `Child`, `Parent`, `Sibling`, `Relationship status` to a new **blocked-label** list in `profile-canonical-schema.ts`. Extraction never writes them as profile entries; they are routed into `contact_relationships` instead.
- Keep only genuinely non-edge facts in the "Relationships & Family" category: `Wedding date`, `Wedding location`, `How we met`, `Anniversary`.
- **Gendered edge labels**: extend `relationship-canonical.ts` so `husband` / `wife` are first-class labels (currently folded into `spouse`). `wife` ↔ `husband` become inverses; `ehefrau`/`ehemann` map onto them. Xihui → Michael becomes `husband`, Michael → Xihui becomes `wife`.
- **Derived status line**: the Relationships section header renders a computed status ("Married") from the presence of a spouse/husband/wife edge — never a stored, LLM-authored string. No more "status: wife".
- **Migration/backfill**: convert existing `profile_entries` rows with blocked relationship labels into `contact_relationships` edges (dedup via the existing `relationshipPairKey`), then delete the entries. Rows that can't be resolved to a known contact are written to the review queue instead of dropped.
- **UI**: the Relationships section moves up to sit directly where "Relationships & Family" was, so there's one visual block.

## 2. No overgeneralized personality traits

"insecure about her weight" must not become the trait "Insecure".

- Add an explicit rule to `PROFILE_EXTRACTION_PROMPT`: only record a personality trait when the note states it as a **stable, general** characteristic of the person. A feeling tied to a specific object, event, or moment is not a trait — skip it or record it with its qualifier intact.
- Deterministic guard: reject single-adjective trait values under the `personality` category unless the source sentence contains a generality marker ("always", "generally", "is a … person", "tends to"). Rejected candidates go to the review queue at low confidence rather than auto-applying.
- Lower the auto-apply threshold for `personality` facts so traits effectively always require review.

## 3. Ban purchases (and other event-shaped facts) from profiles

Purchases are events, not identity.

- New **blocked-label** list covers `Purchased item`, `Purchase`, `Bought`, `Recent purchase`, plus other event-shaped labels. Blocked facts are dropped at extraction, before the review queue.
- Cleanup pass deletes existing entries matching the blocked labels (they remain in notes and the timeline, which is where they belong).
- The same block list gets a deterministic "value hygiene" step for everything that *is* kept: strip redundant leading adjectives (`new`, `some`) and normalize obvious accidental plurals for count-one purchases — but this only matters for surviving labels, since purchases go away entirely.

## 4. Profile language (configurable, default English)

- New per-user setting **Profile language** (default: English), stored on the user's settings row and exposed in Settings → Preferences.
- Extraction prompt gains a target-language instruction: values for **normalizable fields** (job title, relationship status, nationality, languages, marital status, education level, city/country names) are written in the target language — "Modedesignerin" → "Fashion Designer".
- Free-text/verbatim fields (quotes, names, addresses, favorite dishes with proper nouns) stay as written. Names are never translated.
- A one-off normalization pass re-translates existing structured-field values into the user's chosen language, routed through the review queue so nothing changes silently.

## 5. Location: structured, no duplication

Adopt structured fields and drop the redundant blob.

- Canonical `location` labels become: `Current city`, `Current street`, `Postal code`, `Country`, `Timezone`, `Living situation`.
- `Current address` is retired: added to the blocked list, with aliases (`Address`, `Home address`) folded into the structured fields.
- Backfill: parse existing `Current address` values into street / postal code / city / country where confidently parseable; ambiguous ones go to the review queue for confirmation. "Forstwaldstr. 365" → `Current street`; Krefeld already exists as `Current city`, so the duplicate collapses.

## Technical notes

- `supabase/functions/_shared/profile-canonical-schema.ts`: add `BLOCKED_PROFILE_LABELS` (with alias matching) + `isBlockedProfileLabel()`; revise `location` and `relationships` label sets; export the block list into the prompt vocabulary.
- `supabase/functions/process-note/index.ts`: enforce the block list right after canonicalization (alongside the existing `PROFILE_CATEGORY_SLUGS` check); add the trait-generality guard; add language instruction; keep routing relationship facts to `contact_relationships`.
- `supabase/functions/_shared/moment-profile-extraction.ts`: reconcile its independent label seed list with the canonical schema so it can't reintroduce banned labels.
- `supabase/functions/normalize-profile/index.ts` + `_shared/profile-normalization.ts`: block-list enforcement in `writeProfileEntrySafely`, so quick-add and MCP writes are covered too; new backfill actions for relationship migration, address parsing, and language normalization, all run via `EdgeRuntime.waitUntil`.
- `src/lib/relationship-canonical.ts` / `relationship-labels.ts`: add `husband`/`wife` with correct inverses and German aliases.
- `src/components/people/ContactProfileTab.tsx` / `RelationshipsSection.tsx`: reorder so relationships render as one block; derived "Married" status line.
- One migration for the settings column; data backfills run through the insert/data path, not migrations.

## Sequencing

1. Schema module: block list, revised label sets, husband/wife labels (fast, unblocks everything else).
2. Extraction + write-path enforcement (`process-note`, `normalize-profile`, moment extraction).
3. Frontend relationship consolidation and derived status.
4. Profile-language setting + prompt wiring.
5. Backfills: purchases/blocked-label cleanup → relationship migration → address parsing → language normalization, each verified with a SELECT count before and after.
