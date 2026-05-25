
## Goal

Make the Knowledge Graph reflect reality: person profile notes should appear as **person nodes** and be **connected to every note that mentions them** (including alias variants like "Xihui" ↔ "Xihui Wei"). Remove noisy false-positive connections like Michael Hellmich ↔ Gaojie that come from two generic shared tags.

## Diagnosis recap

Three concrete bugs in the current `compute-connections` + graph rendering pipeline:

1. **Person profile notes don't list themselves in `metadata.people`** (e.g. the "Xihui Wei" note has empty metadata). So no other note can match them via the existing string-equality rule.
2. **Person matching is raw lowercase string equality.** "Xihui" never matches "Xihui Wei", "Michael" never matches "Michael Hellmich". We already have alias data on the `people` (contacts) table and via `metadata.matched_people` — `compute-connections` simply doesn't use it.
3. **`shared_topic` is too permissive.** Any 2 overlapping topic strings create an edge with strength 0.5. Generic tags like `health` and `employment` link unrelated people.

Plus a smaller display bug:

4. Some person profile notes have `metadata.type` set to `observation` or `null` instead of `person_note`, so they render as gray observation dots.

## Plan

### 1. Backfill + auto-tag person profile notes

For every note that represents a person profile (linked to a row in the `people` / contacts table, or whose `metadata.type === 'person_note'`):

- Set `metadata.type = 'person_note'`.
- Ensure `metadata.people` contains the person's canonical name **and** all known aliases (full name, short name, nicknames) drawn from the contacts table.
- Do this on save (in the existing person-profile save path) **and** as a one-off backfill edge function for existing notes.

This single change makes "Xihui Wei" connect to every note that mentions "Xihui", and "Michael Hellmich" connect to notes that mention "Michael".

### 2. Alias-aware person matching in `compute-connections`

Replace the current exact-lowercase comparison with an alias-resolving matcher:

- Load the user's contacts/aliases once per invocation into an in-memory map `aliasString -> canonicalPersonId`.
- For each note pair, compare the **set of canonical person IDs** they resolve to, not raw strings. Reuse the existing Levenshtein ≤ 2 fuzzy match from the People Identity system.
- Strength stays similar (0.7 base, +0.1 per extra shared person, capped at 1.0).

### 3. Tighten `shared_topic` to reduce noise

- Require **≥ 3 shared topics** (not 2) for an unconditional edge, with strength 0.6.
- Keep the "2 shared topics OR 1 shared topic + semantic > 0.5" rule, but at strength 0.4 and only when at least one of the shared topics is non-generic.
- Maintain a small **stopword topic list** (e.g. `health, work, employment, travel, general, notes`) loaded from a constant; matches on those alone don't count.

### 4. Fix node `type` in the graph payload

In `get-graph-data`, prefer **`entity_type` when it equals `person_note`**, and treat any note linked to a contact row as `person_note` regardless of `metadata.type`. As a safety net, the backfill in step 1 already corrects `metadata.type`.

### 5. Optional polish (low-risk, high-clarity)

- Add a **"Recompute graph for this user"** admin action that re-runs `compute-connections` for every note after the backfill, so the graph immediately reflects the new rules.
- In the graph side panel, when a person node is selected, show "Mentioned in N notes" with a quick list, so the user can verify alias resolution worked.

## Technical details

Files touched:

- `supabase/functions/compute-connections/index.ts` — alias-aware person matching, stricter topic rule, stopword list.
- `supabase/functions/get-graph-data/index.ts` — robust node-type resolution.
- New `supabase/functions/backfill-person-metadata/index.ts` — one-off: populate `metadata.type='person_note'` and `metadata.people=[name, ...aliases]` for all person profile notes.
- `src/components/people/...` (person profile save path) — on save, sync `metadata.people` with the contact's aliases so new edits stay consistent.
- `src/pages/KnowledgeGraph.tsx` — small label/count in the side panel (optional polish).

No DB migration is required: we're only writing to existing `notes.metadata` and `note_connections` rows.

## What this will visibly fix

- **Xihui Wei** becomes a pink **person node**, centrally placed, connected to "Xihui eating at Oriental Garden", "About Lucy", "Rome Visit Itinerary", "Love & Relationships Strategy", and "Marriage Papers".
- **Michael Hellmich** becomes a person node connected to "Love & Relationships Strategy" and "Marriage Papers"; the spurious Michael ↔ Gaojie edge disappears (only `health` + `employment` overlap, both in the stopword list).
- **Gaojie ↔ Lucy** connects via the existing `Rome Visit Itinerary` mentioning both, *and* — if you mark them as friends in either profile — directly through alias resolution.

After approval I'll implement steps 1–4 first, run the backfill, and confirm the graph in the preview before adding the optional polish.
