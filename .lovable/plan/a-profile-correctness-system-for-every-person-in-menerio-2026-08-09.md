# A profile correctness system for every person in Menerio

Not a cleanup of one account. A permanent mechanism that governs every profile — every user, every contact, every relationship row — so that only accurate, evidenced, sensible entries can exist and stay.

## The structural defect that lets junk into any profile

Verified in the schema before writing this: `contact_relationships.origin` has the column default `'user'`, and the evidence trigger only demands a source quote when `origin` is not `'user'`. Any writer — AI extractor, importer, lexicon enricher, review-queue applier — that omits the column is recorded as "a human typed this" and skips the gate. That is not a bug in one account; it is a hole every profile in the system falls through. A second defect: bond collapse keys invert gendered kin terms to neutral ones (`stepfather` → `stepchild`, `stepson` → `stepparent`), so the two stored halves of a single bond never match and every mirrored bond renders twice, for everyone.

## The mechanism

### 1. Provenance is mandatory, system-wide
- Remove the `'user'` default. A row with no declared origin is rejected by the database.
- Exactly one origin is gate-exempt: `user_manual`, writable only by an authenticated end-user action through the profile UI.
- Every machine origin (`ai_note`, `ai_moment`, `ai_lexicon`, `import`, `review_queue`, `mcp`, `api`) must carry a source quote and a source id, enforced by trigger. No code path can opt out, now or later.
- The same rule is extended to `profile_entries`: machine-written facts carry provenance or are rejected.

### 2. One admission gate every writer must pass
A single adjudicator module decides whether any profile fact or relationship may exist. It enforces, for all profiles:
- **Closed vocabulary** — a role must resolve to a known family, social, or professional term. Unknown labels are refused, not stored and cleaned later.
- **Evidence** — machine claims need a verbatim span from a real note or moment, with a minimum length and a check that the span actually contains both the subject and the claim.
- **Sanity** — no self-edges, no placeholder values, no label-as-value, no cross-language duplicates of an existing fact.
Every writer (`process-note`, moment extraction, lexicon enrichment, review-queue apply, imports, MCP, Hub API, the UI hook) routes through it. A mirror test fails the build if any writer bypasses it or if the frontend and edge copies of the gate drift apart.

### 3. Correct rendering as a system property
- Kin roles normalise to a neutral bond key on both sides before collapse, so one bond is always one row on any profile.
- Rows render from the viewing profile's perspective, using the other person's gender facts only, never a guess from a name.
- Professional roles render under their own subheading, never mixed into family and friends, on every profile.

### 4. Continuous reconciliation across all accounts
A scheduled reconciler sweeps every profile in the system, not one account:
- Auto-repairs what is mechanically decidable: duplicate rows, mirrored duplicates, unknown-vocabulary rows with no evidence, orphan edges pointing at merged or deleted contacts, contact records that duplicate the account owner.
- Sends what needs a human to that user's Review Queue as a single batched pass — Keep / Remove / Correct — with the source note shown when one exists.
- Runs in the background per user so it cannot time out, and records what it changed.

### 5. Legacy rows cannot masquerade as user-entered
Every existing relationship and machine-written fact across all accounts is re-stamped `unverified`, because none of them can honestly claim a human entered them. Unverified rows render dimmed and marked, and each user gets one **Review relationships** pass to confirm, correct, or drop them. Nothing silently disappears; nothing unverified silently stays.

### 6. Health surfacing
Each profile shows an outstanding-violations chip linking into the review pass, and admins get a system-wide violation count by type, so the health of the whole corpus is visible rather than assumed.

### 7. What "done" means here
An acceptance suite that runs against real rows drawn from multiple accounts and fails on: any displayed row without evidence or user confirmation, any person rendered twice on one profile, any professional role inside the personal list, any inverse-direction line, any unknown-vocabulary label, any writer that can insert without passing the gate. The suite output is pasted in the completion message. A failing line means not done.

## Technical notes

- Migration: drop `origin` default; rewrite `relationship_require_evidence()` to reject NULL/unknown origins and exempt only `user_manual`; equivalent provenance trigger on `profile_entries`; backfill all machine rows to `unverified`.
- `supabase/functions/_shared/relationship-adjudicator.ts` becomes the sole write path; `_shared/profile-integrity.ts` and `src/lib/profile-integrity.ts` keep their marker-delimited shared core with a mirror test.
- `relationship-canonical.ts` (both copies): add `familyBondKey()` used by `relationshipPairKey`.
- `RelationshipsSection.tsx`: professional subheading, unverified styling, review-pass entry.
- `profile-lint` gains all-users scope, auto-repair vs needs-review classification, `EdgeRuntime.waitUntil` execution, and a nightly `pg_cron` schedule.
- Rollout order: gate + provenance triggers → writer re-routing → render fix → backfill/re-stamp → reconciler + cron → review pass UI → acceptance suite.
