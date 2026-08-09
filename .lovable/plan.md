# Fixing relationships for real — and fixing why I kept reporting success

## What I verified in your data first

Queried your own profile's relationship rows before writing this plan:

- 20 relationship rows exist. **Every single one has zero evidence records** — including `author: Nate Jones` (written today) and the Jürgen rows (written yesterday). The evidence-first gate exists but is not on the code paths that actually write.
- Jürgen shows 4 times because there are **two separate contacts** — "Jürgen" and "Jürgen Skoppek (Stiefvater)" — and **each stores both directions** (`Jürgen -> stepfather -> me` plus `me -> stepson -> Jürgen`). Your mother has the same double: contacts "Brigitte" and "Mum".
- "Stepson: Jürgen" is not wrong data, it is **wrong rendering**. The row means "I am the stepson of Jürgen". The UI prints every row as `role: other person`, so half of all rows read backwards.
- `author`, `financial advisor`, `tax accountant`, `client`, `manager`, `co-worker` are all stored as personal relationships. There is no rule saying what a relationship is.
- The `entity_kind` column added for classifying contacts is `NULL` on every contact — never populated.

## Why I reported success while the data stayed bad

My verification checked *structural* invariants (no self-edges, no blocklisted labels, no placeholder values) and reported those as green. It never checked the only thing that matters: **does your profile page read correctly to a human**. And the cleanup ran against tables while three newer writers kept inserting unvetted rows behind it. So I fixed a snapshot and declared victory while the faucet was still running.

The fix for that is in this plan too: an acceptance check that reads your actual rendered profile rows and fails loudly if any row is unevidenced, duplicated, or reads backwards.

## What gets built

### 1. One relationship = one row, rendered from your point of view
- Collapse each person-pair into a **single canonical row** at read time; the mirror direction is never displayed separately.
- Render from the viewer's perspective: on your profile Jürgen appears once as `Stepfather: Jürgen Skoppek`, never as `Stepson:`.
- Strip role annotations from displayed names: `Jürgen Skoppek (Stiefvater)` renders as `Jürgen Skoppek`.

### 2. A closed definition of what a relationship is
Only these become relationship rows: family, romantic/partner, friendship, and explicitly stated household/guardianship bonds. Everything else — `author`, `financial advisor`, `tax accountant`, `client`, `manager`, `co-worker`, `service`, `platform`, `provider` — is **not a relationship**. Those move to a separate, clearly labelled "Professional & service contacts" list on the person's card, or are dropped when there is no evidence at all. Anything outside the closed list is rejected at write time, not cleaned up later.

### 3. Close every unvetted write path
Three writers currently insert relationships with only a structural check and no evidence: the moment extractor, the lexicon enricher, and review-queue approval. All three get routed through the same adjudicator, and a **database-level constraint** rejects any relationship row that has no evidence record attached. After this, an unevidenced relationship cannot physically exist — no matter which future code path tries.

### 4. Merge the duplicate people
Merge `Jürgen` + `Jürgen Skoppek (Stiefvater)` and `Brigitte` + `Mum` into single contacts, clean the parenthetical role out of the stored names, and re-point their notes, profile facts and relationships. Run the same duplicate detection across the rest of your contacts and queue anything ambiguous for you rather than guessing.

### 5. One-time cleanup of the existing 20 rows
- Rows whose role is outside the closed list and that have no evidence: **deleted** (this removes `author: Nate Jones`, `financial advisor: michael`, the co-worker and service rows).
- Family/romantic rows with no evidence: kept but marked **unverified**, with the source note quote searched for once; if no quote is found, they go into your review queue in a single batch you can confirm or reject in one pass.
- Mirror rows: kept in the database for querying, hidden from display.

### 6. The acceptance check that should have existed
A script that reads your profile exactly as the UI renders it and fails if: any displayed row lacks evidence, any person appears more than once, any name contains a parenthetical role, any role falls outside the closed list, or any row reads in the inverse direction. I run it against your account and paste the output before I tell you it is done. If it is not clean, I do not report success.

## Technical notes

- Read collapse and perspective rendering: `src/components/people/RelationshipsSection.tsx` plus the shared `relationship-canonical` describe helper; pair-key dedup keyed on the person, not on `person|role`.
- Closed vocabulary lives in `_shared/relationship-canonical.ts` and is enforced by `relationshipWriteDecision`, which every writer already calls — the change is making it reject anything not in the list instead of only rejecting blocklisted labels.
- Migration: `NOT VALID` foreign-key style guard implemented as a trigger on `contact_relationships` requiring a matching `relationship_evidence` row (with a service-role escape hatch for the adjudicator's own two-phase insert), plus backfill of `contacts.entity_kind`.
- Writer paths to re-route: `_shared/moment-profile-extraction.ts`, `enrich-person-from-lexicon/index.ts`, `review-queue-bulk/index.ts`.
- Merge uses the existing `merge-contacts` function; name cleaning strips trailing parentheticals before write.
