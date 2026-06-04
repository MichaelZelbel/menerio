## Goal
Make People profile enrichment understand high-confidence human relationships from all Menerio evidence, not just isolated note snippets, and stop creating duplicate/mirrored relationship rows.

## Findings
- The Xihui profile has two stored Rick↔Xihui `lover` rows in opposite directions. The current unique index only prevents exact same-direction duplicates, not symmetric duplicates.
- The correct fact already exists in the Lexicon: Xihui is Michael’s wife / spouse and married Michael on Jan 23, 2006.
- The profile enrichment button currently runs note + timeline backfills only. It does not consume Lexicon pages.
- Timeline extraction currently skips `me`/self relationships, so a wedding/marriage moment cannot create `Xihui ↔ me = spouse`.
- Note extraction can discard relationship-only results because it returns early when no profile facts are extracted.
- Relationship dedupe uses raw labels/titles (`lover`, `partner`, `spouse`, `wife`) instead of canonical relationship semantics.

## Plan

### 1. Add canonical relationship utilities
Create shared relationship helpers for edge functions and frontend logic:
- Normalize labels:
  - `wife`, `husband`, `married`, `marriage`, `life partner` → canonical `spouse`
  - `girlfriend`, `boyfriend`, `lover` → canonical `partner` or keep `lover` as a separate romantic label only where explicit
- Mark symmetric labels (`spouse`, `partner`, `lover`, `friend`, `sibling`, etc.) so A→B and B→A are treated as the same relationship.
- Generate a stable pair key for `(user, source entity, target entity, canonical label)` independent of direction for symmetric relationships.

### 2. Fix relationship insertion/deduping everywhere
Update these paths to use the canonical pair key before inserting or suggesting:
- Review Queue accept relationship
- `process-note` profile relationship extraction
- `moment-profile-extraction` timeline relationship extraction
- manual relationship save in `useContactRelationships`

Behavior:
- Do not create a mirror review item for symmetric labels.
- Before inserting, check existing rows in both directions.
- If a semantically equivalent row exists, mark the suggestion as kept/already-existing instead of inserting another row.
- Display should still be perspective-aware, but the DB should not need two rows for symmetric relationships.

### 3. Let note extraction keep relationship-only evidence
Fix `process-note` so relationship extraction still runs when there are zero profile facts.

Current problem:
- If the note says only `My wife [[Xihui]]`, the model can return a relationship but no profile fact, and the function exits before creating a relationship suggestion.

New behavior:
- Process facts and relationships independently.
- Relationship-only evidence creates an `add_relationship` suggestion or auto-applies when confidence/prefs allow it.

### 4. Add self-aware relationship extraction for timeline moments
Update `moment-profile-extraction` so timeline evidence can create self relationships.

Behavior:
- Include the current profile display name (`michael`) as self context.
- Accept `me`, `I`, `my`, `Michael`, and the profile display name as self aliases.
- Allow relationships where one side is self and the other side is a participant.
- Add deterministic marriage rules:
  - `X and I got married`
  - `my wife X`
  - `Xihui and my wedding day`
  - `wedding anniversary with X`
  all produce `self ↔ X = spouse` with high confidence when names are clear.

### 5. Add Lexicon evidence to person enrichment
Add a lightweight Lexicon enrichment pass to the existing “Enrich from notes & timeline” action.

Implementation approach:
- Create/reuse an edge function that gathers for one contact:
  - the person’s Lexicon page (`wiki_pages.page_type = 'person'`)
  - related wiki pages mentioning that person
  - current profile entries
  - current relationships
  - timeline moments and note snippets already used by existing enrichers
- Ask the LLM to extract only supported profile facts and relationships from this evidence bundle.
- Run deterministic post-processing on the result:
  - canonicalize `wife/husband/married` to `spouse`
  - dedupe against existing rows and queued suggestions
  - prefer stronger labels (`spouse` outranks `partner`/`lover`) when the evidence explicitly says married/wife/husband

### 6. Clean up the current Xihui data
Add a migration/data repair for the current duplicate and missing relationship:
- Remove one of the duplicate Rick↔Xihui `lover` rows, preserving the older accepted relationship/suggestion history.
- Insert one relationship row between `self` and Xihui Wei with canonical label `spouse` if it does not already exist.
- Optionally add a Xihui profile entry in `Relationships & Family`: `Spouse: Michael` if the category exists and no equivalent entry exists.

### 7. Add database-level protection for future duplicates
Add a DB helper/index strategy to prevent symmetric duplicates from returning:
- Store or compute a normalized relationship key.
- Enforce uniqueness on canonicalized direction-independent pairs for symmetric labels.
- Keep existing exact-direction uniqueness for asymmetric labels like `employee/employer`, `parent/child`, `mentor/mentee`.

### 8. Verify with Xihui as the regression case
After implementation:
- Run the enrichment for Xihui.
- Confirm the profile shows:
  - one Rick relationship, not two
  - `spouse`/wife relationship to Michael/self
- Confirm the Review Queue does not generate a duplicate mirror suggestion.
- Check edge function logs for skipped/inserted relationship counts.

## Technical notes
- No change to the selected model/provider is required for this fix.
- The main improvement is not more model intelligence alone; it is giving the model the right evidence and enforcing deterministic relationship semantics after the model responds.
- Sensitive/intimate notes should still be processed through the existing sensitivity controls; this plan avoids quoting sensitive content into UI messages unnecessarily.