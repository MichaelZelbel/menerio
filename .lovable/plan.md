## What's actually wrong (verified against your DB)

Three real bugs are stacked on top of each other:

**1. Three rows in the DB describe the same fact about Gunther.**
- `self → Gunther` label `report` ("I am Gunther's report") ✓ correct
- `Gunther → self` label `manager` ("Gunther is my manager") ✓ correct — same fact, opposite direction
- `Gunther → self` label `reporting manager` (custom, non-canonical) — same fact again

The dedup pair-key in `relationship-canonical.ts` only deduplicates *symmetric* labels (spouse, friend…). For asymmetric pairs (`manager`↔`report`, `parent`↔`child`, `employer`↔`employee`) it treats each direction as distinct, so the inverse pair slips through. And `"reporting manager"` isn't in the canonical map at all, so it bypasses dedup entirely.

**2. The "report Gunther" label reads as "Gunther is my report".**
The row `self → Gunther / label: report` is technically "self is Gunther's report", but `RelationshipsSection` shows it as `[report] Gunther` when viewing self's profile, which any reader parses as "Gunther = report". The forward label is correct in storage but wrong as a *display label from self's perspective*. From self's perspective we should show the **inverse** (`manager`) so it reads `[manager] Gunther`.

**3. Yumei → michael (partner) doesn't show on My Profile because "michael" is a separate contact, not self.**
There's a contact row `michael` (id `ca58bf73…`) sitting next to your real user. The Yumei↔Rick "lover" you mentioned, and Yumei↔michael partner, are all stored as `contact↔contact` between Yumei and that ghost contact. Self-recognition never folded that ghost into self, so My Profile never sees the relationship. Same root cause as the Xihui issue from before — extraction created a `michael` contact instead of resolving to self.

## The fix

### A. Direction-independent dedup for asymmetric inverse pairs

In `supabase/functions/_shared/relationship-canonical.ts` (+ frontend mirror):

- Extend `relationshipPairKey` so that when a label has a known `INVERSE_LABEL`, the key is built from a canonical `(min, max)` ordering of (refKey + label, refKey_other + inverse_label). Result: `self→Gunther/report` and `Gunther→self/manager` collapse to one key.
- Add `"reporting manager"`, `"line manager"`, `"direct report"`, `"reports to"`, `"manages"` to `LABEL_CANONICAL` so custom phrasings collapse to `manager`/`report`.
- Apply the same logic everywhere we currently call `relationshipPairKey`: the upsert hook (`useContactRelationships.ts`), the suggestion-apply path in `enrich-person-from-lexicon`, and the Review Queue apply.

### B. One-shot cleanup migration

Walk existing `contact_relationships`, group by the new pair key, keep the oldest row per group, delete the rest. This will collapse the three Gunther rows into one.

### C. Perspective-aware display label

In `src/lib/relationship-labels.ts` / `RelationshipsSection.tsx`:

- When viewing entity X and the stored row is `X → Y / label: L`, currently we show `[L] Y`. Change to: show `[inverseLabel(L)] Y` when `L` has a registered inverse (asymmetric). Symmetric labels stay as-is.
- Net effect on your profile: `[manager] Gunther Reinhard` instead of `[report] Gunther Reinhard`. And on Gunther's profile it reads `[report] Michael`.
- Keep `custom_label` rendering verbatim only when there's no canonical mapping; once `"reporting manager"` is canonicalized to `manager`, it'll render correctly from both sides.

### D. Self-recognition: auto-merge ghost "michael" contact into self

The deeper bug behind Yumei's invisible relationship. Add to `enrich-person-from-lexicon` (and run once as part of the cleanup):

- For every contact whose name or alias matches a self-alias (`michael`, `Michael`, `MichaelZelbel`, `me`, `I`), and where the contact has no independent evidence of being a distinct person (no email, no phone, no externally-sourced profile), automatically:
  - Rewrite all `contact_relationships` where this contact is source/target to point at `self`.
  - Rewrite `matched_people`, `notes.contact_id` refs, moments, etc. (reuse the existing `merge-contacts` function, but with `target = self`).
  - Delete the ghost contact.
- Surface the action in the Review Queue as "auto-merged ghost self-contact, click to undo" rather than silently doing it, so you can audit.

After D runs, Yumei↔michael becomes Yumei↔self with label `partner`, and it appears on My Profile correctly (and bidirectionally, because `partner` is symmetric).

### E. Optional: separate "Work" section vs. "Relationships"

You raised that a reporting manager isn't really a "relationship". Add a lightweight grouping in `RelationshipsSection`: split rendered rows into **Personal** (spouse/partner/family/friend/lover/neighbor/roommate) and **Work** (manager/report/employer/employee/co-worker/mentor/mentee/client/provider). Same data model, just two subheadings, with Work collapsed by default. No new tables.

## Why this will actually hold up

- The dedup fix removes the *class* of bug, not just the Gunther instance — every future asymmetric pair (parent/child, employer/employee, mentor/mentee, teacher/student) is protected.
- The display fix means the AI's storage stays semantically correct (`source is L of target`) while the UI always reads from the viewer's perspective.
- The ghost-self merge closes the loop that's been making partner/lover relationships disappear from My Profile for months. It's the same root cause we hit on Xihui.

## Out of scope

- No changes to the LLM prompt for this round — the AI is already producing reasonable rows; the failures are in dedup, display, and self-resolution.
- No new tables.

## Technical notes

- Files touched: `supabase/functions/_shared/relationship-canonical.ts`, `src/lib/relationship-canonical.ts`, `src/lib/relationship-labels.ts`, `src/components/people/RelationshipsSection.tsx`, `src/hooks/useContactRelationships.ts`, `supabase/functions/enrich-person-from-lexicon/index.ts`, `supabase/functions/merge-contacts/index.ts` (allow `target=self`), one cleanup migration.
- The cleanup migration is idempotent; safe to re-run.
- Ghost-self merge logs every rewrite to the Review Queue with full undo payload.
