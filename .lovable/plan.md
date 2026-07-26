## What I found (verified against the live database)

Viewing Xihui, several things go wrong at once:

1. **Two sections by design, which is wrong.** The graph card ("Relationships") and the fact category ("Relationships & Family") are separate components. The fact category still holds rows for this person (`Wedding date`, plus leftovers `Relationship`, `Relationship type`, `Relationship to Mike`, `Watched series together`), so it renders too. The block list added last time covers `spouse/partner/...` but not `Relationship`, `Relationship type`, `Relationship to <name>`.

2. **Edges are not canonicalized on write.** For one Xihui record the database holds, all pointing at me: `spouse`, `partner`, `romantic partner`, `intimate partner`, `sexual partner`, `romantic interest`, `companion`, `partner (companion)`, `lover`, `friend`, `friend/colleague`, `friend or colleague`, `acquaintance`, `team member`, `collaborator`, `manager or coordinator`, `employer`. A pair-key helper exists, but free-text LLM labels like "romantic partner" aren't in the synonym map, so each variant becomes its own row.

3. **Direction is ambiguous in the UI.** Tiles render the label next to a name with no indication of who holds the role.

4. **Duplicate contacts.** Four `Xihui` rows exist; two are merged into one, but `7d18…` and `ee7a…` are both live, each with its own edges and facts.

## Plan

### 1. Directional, gendered display: "Role: Name"
- Every relationship tile renders as **`Role: Name`**, where *Role* is always the role **the other person holds toward the profile owner**. On Xihui's profile: `Husband: Michael`. On Yumei's profile: `Boyfriend: Michael`. On my own profile: `Wife: Xihui`, `Girlfriend: Yumei`.
- Implement as a single `describeRelationship(viewedPerson, otherPerson, storedEdge)` helper used everywhere (profile card, People tree, review queue, lexicon) so no surface can disagree.
- **Gender resolution** for gendered roles, in order: the other person's `gender`/pronoun fact in their profile → an explicitly gendered stored label (`husband`, `wife`, `boyfriend`) → neutral fallback (`Spouse:`, `Partner:`). Never guess from the name.
- Gendered pairs handled: spouse → Husband/Wife, partner → Boyfriend/Girlfriend, parent → Father/Mother, child → Son/Daughter, sibling → Brother/Sister. Everything else stays neutral (`Friend:`, `Manager:`, `Employer:`).
- Storage stays neutral and canonical (`spouse`, `partner`); gender is applied at render time only, so a corrected gender fact instantly fixes every tile.

### 2. One relationship surface, everywhere
- Extend the block list so `Relationship`, `Relationship status`, `Relationship type`, `Relationship to <anything>`, `Relation` never become profile entries; the ones naming a person get routed into the graph.
- Move remaining relational facts (`Wedding date`, `Anniversary`, `How we met`) into the single **Relationships** card as a small milestones strip, and stop rendering the `relationships` fact category as a separate section.
- Result: exactly one Relationships card per profile, identical structure everywhere.

### 3. Canonicalize every label on write
- Expand the synonym map: `romantic/intimate/sexual partner`, `romantic interest`, `companion`, `partner (companion)`, `girlfriend`, `boyfriend`, `fiancé(e)` → `partner`; `wife`/`husband`/`married` → `spouse`; `friend/colleague`, `friend or colleague`, `buddy`, `acquaintance` → `friend`; `team member`, `collaborator` → `co-worker`; `manager or coordinator`, `boss`, `supervisor` → `manager`. Unmapped labels are stored lowercase-trimmed so they can't duplicate themselves.
- Same map in both the frontend and the edge-function copy.

### 4. Prevent duplicates at the database level
- Normalized pair-key column + unique index on `contact_relationships`, and a before-insert trigger that canonicalizes the label and rejects an insert matching an existing pair in either direction (respecting symmetric vs. inverse labels).
- Precedence for the same pair: `spouse` > `partner` > `lover` > `friend` > `acquaintance`. So Xihui collapses to a single `Husband: Michael` tile and the `spouse`/`partner`/`spouse` rows disappear. Different edges to *different* people are untouched.

### 5. Clean up existing data
- One-off migration: canonicalize all labels, collapse duplicates by pair key with the precedence rule, delete relationship-shaped profile entries, keep wedding/anniversary/how-we-met facts.
- Surface the two live `Xihui` contacts in the existing merge flow for you to confirm — no silent merge.

### 6. Proof
Before/after counts from direct SQL plus the exact resulting tiles for Xihui and Yumei pasted back to you.

## Technical notes
- Files: `src/lib/relationship-canonical.ts`, `src/lib/relationship-labels.ts` (rewritten around `describeRelationship`), `src/hooks/useContactRelationships.ts`, `src/components/people/RelationshipsSection.tsx`, `src/components/people/ContactProfileTab.tsx`, `supabase/functions/_shared/relationship-canonical.ts`, `_shared/profile-canonical-schema.ts`, `process-note`, `normalize-profile`.
- Two migrations: schema (pair-key column, unique index, trigger) and data cleanup.
- Unit tests for `describeRelationship` covering both viewing directions, gendered/neutral fallback, and symmetric labels; plus a test asserting the frontend and edge canonical maps are identical so they can't drift.
