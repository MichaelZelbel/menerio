# Profile data: replace label dedup with a fixed-schema fact model

## Why the current concept failed

The current system deduplicates **labels**. Your example is not a label duplicate:

```text
Age moved out: 16              (label A, value "16")
Life events: moved out at 16   (label B, value "moved out at 16")
```

Different labels, different value strings, same fact. No label matcher can catch that, so the approach is structurally incapable of solving the problem. The same pattern shows up elsewhere on this profile today: `Wants` overlaps `Pet wish` and `Desired VRChat upgrade`; `Favorite food item` overlaps `Favorite snacks` and `Favorite desserts`. Every fix so far added another matcher on top of a model that lets the AI invent a new label whenever it wants.

## The better concept: no invented labels, ever

Stop treating the label as free text produced by the AI. A profile becomes a **fixed schema of fields**, and every extracted fact must land in one of them.

1. **Closed field catalog.** One curated list of fields per category (roughly 80-120 total), each with a type: single-value (Occupation, Birthday, Email), list (Favorite foods, Skills), or event (Life events). The list lives in one file and is mirrored into the database.
2. **The AI never names a field.** Extraction is given the catalog and must pick a field ID from it. If nothing fits, the fact goes to the catch-all field for that category (e.g. `Life events`, `Other notes`) — it never creates `Age moved out`. This alone removes the entire class of problem you keep hitting.
3. **Facts, not strings.** Each fact is stored as `field_id + normalized value + optional qualifiers (age / date / place) + source quote`. "moved out at 16" becomes `Life events: moved out (age 16)`. "Age moved out: 16" cannot exist, because `Age moved out` is not a field; the age is a qualifier, not a field.
4. **One fact key per fact.** A deterministic key is computed from `field_id + normalized content tokens + qualifier`. Same key = same fact, so the second write updates the first instead of adding a row. Because the age moved into a qualifier, both of your rows now collapse to the same key automatically — deterministically, no LLM involved.
5. **Cross-field guard for the remaining cases.** Before a fact is written, it is checked against the existing facts of the same person that share content tokens. If an existing fact contains it, the write is dropped; if it extends it, the existing row is replaced. Only genuinely ambiguous cases go to a single adjudication step — and the result is written, not queued to you.
6. **Rendering is derived, not stored.** One renderer per field type: single value inline, lists as bullets, events as a dated/aged timeline. There is no per-surface formatting logic left to drift.

## What I can and cannot guarantee

Guaranteed, because it is deterministic and enforced in the database:

- No label outside the catalog can ever be stored — a write with an unknown field is rejected, not queued to you.
- No two rows with the same fact key can coexist (unique constraint).
- No duplicate value inside a list field.
- Rendering is uniform everywhere (single renderer, covered by tests).

Not guaranteed with a mathematical promise: two facts that share **no** tokens and **no** field (e.g. "grew up in Recife" vs "childhood in northeast Brazil"). The catalog + qualifier model shrinks this to a narrow residue, and the containment check catches most of it, but I will not claim 100% on paraphrase. I would rather say that now than tell you it is solved again.

## Migration of existing data

- Map every existing label to a catalog field; anything unmappable becomes a `Life events` / `Other notes` fact with its qualifier extracted.
- Recompute fact keys for all rows and collapse collisions, keeping the longest-sourced value.
- One-off report of what merged, so you can spot-check.

## Technical notes

- `profile_fields` becomes the authoritative catalog (`field_id`, category, type, aliases, qualifier rules); a DB trigger rejects any `profile_entries` row whose field is not in it — no auto-creation path remains.
- New columns on `profile_entries`: `field_id`, `qualifiers jsonb`, `fact_key text`, with `unique (contact_id, fact_key)`.
- Qualifier extraction (age/date/place) is deterministic regex + a normalization function, applied in the trigger so it holds regardless of which edge function writes.
- `process-note` and `normalize-profile` are changed to emit `field_id + value + qualifiers`; the "propose a new label" path and its review-queue item type are deleted.
- Rendering consolidates on `ProfileValue` / `ProfileSections` with one branch per field type.
- A test suite asserts the invariants above, including the exact case from your report.

## Rollout

1. Catalog + schema + trigger, with the old path still writing (shadow mode).
2. Migrate and collapse existing data, produce the merge report.
3. Switch extraction to field IDs, remove label invention and its review-queue type.
4. Rendering consolidation + invariant tests.
