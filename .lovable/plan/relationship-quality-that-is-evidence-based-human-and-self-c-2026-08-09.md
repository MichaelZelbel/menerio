# Relationship quality that is evidence-based, human, and self-correcting

## The actual failure

This is not a vocabulary problem. The current pipeline asks the model to extract a relationship and then treats a sufficiently confident answer as data. It validates the shape of that answer, not whether the relationship makes sense in the person's life.

The current account data confirms the distinction:

- There are **90 stored relationship rows** and **no duplicate `pair_key` values**. Exact structural deduplication is working, yet the result is still poor because semantically equivalent or nonsensical claims receive different labels.
- The extraction pipeline auto-applies relationships at its default confidence of `0.72`, while the balanced threshold is `0.70`. A single model answer therefore normally becomes permanent data without a second judgment.
- **89 of 90** stored rows can be traced to a Review Queue record with a source note ID, but `contact_relationships` stores no evidence quote, relevance judgment, or person-verification result. “Came from this note” is not the same as “this note states this relationship.”
- The account contains contacts named `Menerio`, `Hub`, `Infy`, `HR`, `Captain`, and `Coach`; their metadata is empty, so downstream relationship extraction has no reliable entity identity to consult.
- The existing repair only removes blocked labels, self-edges, and exact duplicate pair keys. It never rereads the source note to decide whether the claim is true, meaningful, or about a real person. That is why the repair reported success without repairing the actual problem.

## The quality rule

A relationship may be stored only when all four statements are supported:

1. **Identity:** both endpoints resolve to real people, not a company, product, role, avatar, fictional character, celebrity merely mentioned, or generic job description.
2. **Personal relevance:** the person has an ongoing or meaningful place in the subject's life. Incidental contact—such as a bakery assistant appearing once—does not qualify.
3. **Relationship evidence:** the source actually states or clearly demonstrates the relationship. Mere co-occurrence, a name in a list, admiration, or one transaction is insufficient.
4. **Non-duplication:** the same human connection is not already represented, even if another note phrases it differently or reverses its direction.

No denylist or allowlist decides this. Deterministic checks catch obvious structural failures; a context-aware adjudicator handles meaning; uncertain cases go to the user rather than becoming facts.

---

## 1. Replace “extract then trust” with a relationship adjudicator

Relationship extraction becomes a two-stage process:

### Stage A — candidates

The first pass may propose a person or relationship, but proposals are inert. It must include:

- the two mentioned identities;
- the proposed human-readable relationship;
- an exact quote from the note;
- the surrounding passage;
- whether the note describes direct interaction, an enduring bond, a professional relationship, or merely a mention;
- the note ID and date.

### Stage B — independent judgment

A separate structured evaluation receives the candidate, the quoted passage, the relevant note context, existing identities/aliases, and existing relationships. It returns independent decisions for:

- `real_person_a` and `real_person_b`;
- `personally_relevant`;
- `relationship_supported`;
- `incidental_or_transactional`;
- `fictional_or_roleplay`;
- `same_as_existing_relationship`;
- a concise normalized display label derived from the evidence;
- a confidence and human-readable reason.

The adjudicator is explicitly told that a shop assistant, article author, celebrity, fictional character, avatar, passing customer, and one-off service provider are not life relationships merely because they appear in a personal note.

Only a unanimous high-confidence result writes automatically. Any failed condition is discarded with an audit reason. Any genuinely ambiguous identity or significance decision goes to the Review Queue with the source quote visible.

## 2. Make identity a prerequisite, not a guess after contact creation

Before creating or linking a person, run the same evidence-backed identity judgment:

- resolve against existing names and aliases using exact, normalized, and conservative fuzzy matching;
- classify the mention from its context as real known person, public person only mentioned, organization/product, fictional character, avatar/handle, role/title, or unclear;
- require evidence of personal relevance before proposing a new contact;
- reuse a matching contact rather than creating another person record;
- never turn a role noun such as “coach,” “HR,” or “shop assistant” into a person without an actual personal identity in the note.

Classification is stored with its evidence and can be revised. It is not based on a permanent list of names or roles.

## 3. Store evidence with every relationship

Add relationship provenance records rather than overloading the relationship row. Each supporting or contradicting source records:

- relationship ID;
- source note ID;
- exact evidence quote and context;
- adjudication outcome and reason;
- identity and relevance judgments;
- confidence;
- extraction/adjudication version and timestamp.

A relationship may have multiple supporting notes. Reprocessing a note replaces that note's evidence instead of creating another edge. If a note is edited or deleted, its evidence is withdrawn and the relationship is reevaluated from what remains.

This makes “Why is this relationship here?” answerable from the UI and makes cleanup reproducible.

## 4. Deduplicate meaning, not labels

Deduplication happens in this order:

1. Resolve both names to stable person IDs.
2. Compare the unordered person pair, accounting for direction.
3. Compare the meaning of the new claim with existing claims and their evidence.
4. Add the note as further evidence when it describes the same connection.
5. Replace a vague label with a more precise supported label when appropriate, without creating a second row.
6. Keep genuinely simultaneous, distinct roles only when the evidence supports both—for example, colleague and friend.
7. Send true contradictions to review; never infer exclusivity or monogamy.

The existing `pair_key` remains the last database-level race guard, but it is no longer mistaken for semantic deduplication.

## 5. Repair the existing account by rereading the evidence

The repair must not reuse the current lint rules. It runs every existing relationship through the same adjudicator:

1. Snapshot every current relationship and its linked Review Queue record for rollback.
2. Reload the actual source note(s); find the passage that allegedly supports the claim.
3. Re-resolve both endpoints as identities.
4. Evaluate real-person status, personal relevance, explicit support, and semantic duplication.
5. Apply only deterministic/high-confidence outcomes:
   - remove unsupported, fictional, non-person, incidental, and self-referential rows;
   - merge semantic duplicates while retaining every valid source as evidence;
   - correct direction or wording when the source clearly supports it;
   - quarantine ambiguous cases in the Review Queue with the quote and recommended action.
6. Evaluate suspicious contact records that exist only because of bad extraction. Remove an invalid contact only when it has no valid independent notes, profile facts, moments, group memberships, or user-created content; otherwise queue it for review.

The run is resumable, idempotent, and processed in small background batches so it cannot time out or overwhelm the browser.

## 6. Prove that the repair happened

The repair is not complete when a function returns `ok`. It is complete only after a post-run audit reports:

- relationships before and after;
- kept, removed, merged, relabeled, and queued counts;
- counts by reason;
- every changed row with people, old label, new outcome, source note, evidence quote, and reason;
- remaining relationships without valid evidence (must be zero outside the Review Queue);
- remaining edges involving non-person identities (must be zero);
- remaining semantic duplicate clusters (must be zero);
- failures or notes that could not be read.

The first production run targets the affected account and produces this itemized report for inspection. It does not claim success while any batch failed or any unclassified row remains.

## 7. Keep it clean continuously

- New relationships must pass adjudication before insertion, regardless of suggestion sensitivity mode.
- Reprocessing is keyed by note and replaces old evidence atomically.
- A nightly reconciliation checks evidence integrity and orphaned/contradictory claims, but does not repeatedly call AI for unchanged evidence.
- Accepted or rejected Review Queue judgments become account-specific examples supplied to later adjudications, improving relevance without hardcoding global lists.
- Metrics track proposal acceptance, rejection reasons, duplicate suppression, and false-positive reversals. A rise in bad proposals becomes visible rather than silently polluting profiles.

## User experience

- Normal high-confidence relationships appear automatically and remain proactive.
- Every relationship has a subtle “Why?” action showing the supporting note excerpt(s).
- Ambiguous review items show the people, proposed relationship, exact quote, and three direct actions: keep, correct, or remove.
- The cleanup report is readable and reversible; it is not a raw log.

## Implementation order

1. Add evidence/provenance storage and the structured adjudication contract.
2. Route new contact and relationship candidates through identity, relevance, and evidence judgment.
3. Add semantic person-pair deduplication and evidence accumulation.
4. Update Review Queue cards and the relationship “Why?” view.
5. Build the resumable repair/audit runner with rollback snapshots.
6. Run it on the affected account and inspect the itemized result.
7. Enable continuous reconciliation only after the repaired sample passes the acceptance cases below.

## Acceptance cases

- “My wife Xihui…” creates or supports one relationship with Xihui.
- Repeated notes saying “wife,” “spouse,” and “partner” add evidence to one connection rather than three rows.
- A note mentioning a bakery assistant creates neither a contact nor a relationship unless the text establishes an ongoing meaningful connection.
- A fictional character, VRChat avatar, product, company, AI assistant, or role title creates no person relationship.
- “I admire Clooney” does not create a personal relationship with Clooney.
- “Maria and I have been friends since school” does create/support a friendship and retains that sentence as evidence.
- Colleague plus friend is preserved when both are supported; partner plus ex-partner is reviewed when the timing is unclear.
- Rerunning the same note or the full repair changes nothing a second time.

## Technical scope

- Database: relationship evidence/provenance and repair-run audit storage, with owner-scoped RLS and explicit grants.
- Backend: `process-note`, shared identity/relationship adjudication, `profile-lint` replacement/extension, and batched repair execution using `EdgeRuntime.waitUntil`.
- Frontend: Review Queue evidence cards, relationship evidence disclosure, and cleanup report.
- Tests: quoted-evidence validation, incidental-person rejection, fictional/non-person rejection, identity resolution, semantic deduplication, note-reprocessing replacement, rollback, and the acceptance cases above.