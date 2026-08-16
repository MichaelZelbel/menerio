# Profiles that actually make sense — closed vocabulary, enforced in the database

## Why this keeps coming back

Every previous fix lived in a place that a later change could walk past: a prompt, one component, one edge function. The label vocabulary was open — anything the extractor invented got written. That is why Yumei's profile reads like this today (these are her live rows):

```text
Personality traits   social anxiety, sensitivity
Social anxiety       has social anxiety
Social anxiety       yes
Temperament          anxious
Social behavior      anxious
Traits               anxious

Second job           Private bakery service
Additional work      Private bakery service
Other occupation     Private bakery service

Life events          Started working at age 14, moved out at 16
Life history         Started working at age 14, moved out at 16

Physical health          Endometriosis
Physical health issue    Endometriosis
Medical history          Hospitalized as child
Health history           Hospitalized as a child
History                  Hospitalized for mental health as a child
```

Six labels for one trait. Three labels for one job. A value that is literally the word "yes". A value that just repeats its own label.

So this plan does not add another guard in another file. It moves the rules into Postgres, where every writer — extractor, normalizer, review queue, MCP, the UI, a future feature nobody has written yet — has to pass through them.

## 1. A closed field vocabulary (the anti-drift mechanism)

One registry table, `profile_fields`: canonical label, category, cardinality (single value vs. list), value type, and its synonyms. Seeded from the existing canonical schema plus every synonym visible in live data (`Additional work`, `Other occupation`, `Second job` → **Occupation (secondary)**; `Temperament`, `Social behavior`, `Traits`, `Personality traits` → **Personality traits**; `Health history`, `Medical history`, `History` → **Health history**; and so on).

A `BEFORE INSERT OR UPDATE` trigger on `profile_entries`:

- rewrites any synonym to its canonical label;
- rejects a label that is in neither list — the write does not silently land under an invented name; it is routed to the review queue as an unknown-field item instead;
- enforces cardinality: a `single` field can hold one row per subject, a `list` field accumulates values in one row.

Because this is a trigger, no future prompt change, edge function or component can reintroduce `Other occupation`. That is the concrete reason this one lasts where the earlier ones did not.

## 2. A value-quality gate (kills "yes" and "has social anxiety")

Same trigger path, deterministic, no LLM:

- reject boolean-ish filler values (`yes`, `no`, `true`, `n/a`, `unknown`, `-`);
- reject a value that only restates its label (`Social anxiety: has social anxiety`) — the label already carries the fact;
- reject empty/one-character values and values identical to the person's own name;
- strip leading verbs from trait values (`has social anxiety` → `social anxiety`) before the restatement check, so a genuinely new value survives in clean form.

## 3. Semantic deduplication across labels

Beyond the existing same-label token dedup:

- **Same value, different label** — when the incoming value already exists under a sibling field in the same category, the write merges into the canonical field instead of creating a second row (that is what would have stopped `Second job` / `Additional work` / `Other occupation`).
- **Subset values** — `Hospitalized as child` inside `hospitalized as a child for mental health` collapses to the longer one.
- **List fields** are stored as one row with de-duplicated values, so `Personality traits` can never split into four label variants again.

A nightly job re-runs the same collapser over all users and reports anything that slipped, so drift becomes visible instead of accumulating silently.

## 4. One-time global cleanup of every profile — yours included

A background rebuild pass (all users, all subjects, including the Menerio user's own profile) that pushes every existing row through the pipeline above and rewrites the result:

- canonicalize labels, merge equal/subset values, collapse list fields into one row each;
- delete filler and self-restating values (`Social anxiety: yes`, `Social anxiety: has social anxiety`);
- merge the health-history cluster into one `Health history` list, the food cluster into `Favorite foods`, the VRChat cluster into `Digital life`, the name/nickname cluster into `Nickname`;
- delete values that are noise rather than facts.

It runs in the background with progress, since it touches every row.

## 5. Rendering: one component, both profiles, one relationship card

- The person page and `/dashboard/profile` render the **same** profile component tree. Today they compose their own; after this they call one `ProfileSections` component, so your own profile cannot look different from a contact's.
- Every row renders through `ProfileRow` (`Label:` then value) and `ProfileValue` (bullets for multi-value). No surface formats values on its own.
- Exactly one relationship surface. Relationship-shaped rows are excluded from the facts panel by *field kind* in the registry, not by matching a category slug — a category named "Relationships & Family" versus "Relationships" can no longer produce a second card. The professional-contacts card is folded back in as a labelled group inside the single relationship card, so there is one card, not two.

Note on the doubled relationship section: I have not been able to reproduce it from the code alone — the person page renders the section once, and the only other card is "Professional & service contacts". Rather than assert a cause I cannot see, step 5 removes the possibility structurally (single card, registry-driven exclusion) and adds a test that fails if more than one relationship surface renders on either profile page.

## Why you can check this instead of trusting me

- The rules are **in Postgres**. You can verify them yourself: try inserting `Other occupation: Private bakery service` on any profile and the row comes back as `Occupation (secondary)`, merged, not duplicated. A prompt regression cannot undo that.
- **Tests that encode your exact examples**: the six anxiety rows, the three bakery rows, the two life-event rows, the "yes" value — each is a test case that fails if the behaviour regresses.
- **After the rebuild I will paste the actual before/after row dump** for Yumei and for your own profile, queried live, not described from memory. If the dump still shows duplicates, the work is not done and I will say so.

## Technical notes

- New: `profile_fields` registry table + seed, `profile_entry_canonicalize()` trigger (label rewrite, quality gate, cross-label merge), nightly lint job.
- Changed: `_shared/profile-canonical-schema.ts` reads the same vocabulary; `process-note` and `normalize-profile` stop being the enforcement point and just propose; `review_queue` gains an unknown-field item type.
- Frontend: new `ProfileSections`, used by `ContactProfileTab` and `src/pages/Profile.tsx`; `RelationshipsSection` collapses to one card with grouped rows.
- Tests: registry canonicalization, value gate, cross-label merge, single-relationship-card rendering, own-profile/contact-profile parity.
