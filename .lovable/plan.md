# Profile Integrity System

Goal: person records (yours and every contact's) contain only information a human would call accurate, non-duplicated and consistent — and stay that way permanently.

## What the data actually shows

I queried your live relationship and profile rows. The 23-item mess on your profile is not one bug, it is six distinct failures:

1. **Both directions of one edge are stored and rendered as two items.**
   `Brigitte —mother→ Self` and `Self —son→ Brigitte` are two rows, so you see "Mother: Brigitte" *and* "Parent: Brigitte". Same for Jürgen Skoppek (Stepson/Stepfather), Christian Maronna (Provider/Tax accountant), Jürgen (Parent/Father).
   Cause: `pair_key` includes the label, and `parent`/`mother` are treated as different labels, so the dedup key never collides.
2. **Junk role labels are accepted verbatim** from note extraction: `subject of notes`, `protector`, `protectee`, `admirer`, `owner`, `roleplay character`.
3. **Self-referential edges**: a contact literally named "michael" (you) holds `financial advisor → Self`.
4. **Duplicate people produce duplicate roles**: `Brigitte` and `Mum` are two contacts, both "mother of self". Same class of bug: 3× "Xihui", 3× "Ali Abdaal", 2× others.
5. **Contradictions are not detected**: `Spouse: Xihui` and `Partner: Yumei` coexist, and the header derives "Married" from whichever wins.
6. **Facts have the same quality problems**: `Gym: Gym`, `Graduation year: none`, `Planned action: 2026-12-31`, and one value stored four times under four labels (`Interests` / `Topics of interest` / `Areas of interest` / `Discord information topics` = "AI, blockchain, VRChat"), plus `Communication platform` / `Preferred communication platform` / `Primary communication platform` = Discord.

Previous attempts failed because they were **LLM-first and single-layer**: one cleanup pass, run once, on one write path, with nothing preventing the next writer from re-introducing the same rows. This plan is deterministic-first and enforced at four layers, with the database as the last line of defence.

## The mechanism — four layers

### Layer 1 — One canonical vocabulary (deterministic, no LLM)

A single source of truth defining, for every role and every fact label:
- canonical name, synonyms (incl. German), and **role family** (`marriage`, `romance`, `parent-child`, `sibling`, `work-hierarchy`, `work-peer`, `professional-service`, `social`);
- which side of a family is the "source" side, so an edge has exactly **one** storage form;
- cardinality and evidence rules per semantic role. These are not moral or monogamy rules: romantic relationships with different people are valid and must be preserved unless the user explicitly records exclusivity or the evidence contains a direct contradiction;
- a **blocklist** of non-relationships (`subject of notes`, `owner`, `protector`, `protectee`, `roleplay character`, `admirer`, `mentioned with`, …) and non-facts.

Same file mirrored to frontend and edge functions, byte-identical, asserted by the existing mirror test pattern.

### Layer 2 — A write gate every path must pass

One shared `assertRelationshipWrite` / `assertProfileEntryWrite` used by *all* writers (`process-note`, `enrich-person-from-lexicon`, `moment-profile-extraction`, `normalize-profile`, `menerio-mcp`, `review-queue-bulk`, the UI form). It rejects or rewrites before insert:

- blocked/unknown-junk labels → rejected;
- edge whose other end is you (matched against `user_self_aliases` + your own name) → rejected;
- an edge already present in the **other direction** within the same role family → rejected (this alone kills 8 of your 23 items);
- generic role when a specific one exists for the same pair (`parent` vs `mother`) → collapses to the specific;
- a second edge for the **same person and same semantic role** → not written as a duplicate;
- multiple partner/romantic edges to different people → preserved by default. They are only flagged as a conflict when there is explicit exclusivity evidence (for example, a direct statement that a relationship is exclusive/monogamous) or two facts cannot both be true. No relationship status is inferred from cultural, moral, marital, or gender assumptions;
- fact value gate: rejects `value == label`, `none/n-a/unknown/-`, values under 2 chars, a bare date under a non-date label, and the person's own name as a value;
- fact synonym folding: `Topics of interest` → `Interests`, and if the same normalized value already exists on that person under any label in the same family, the write is skipped.

**Backstop:** the same rules re-implemented as Postgres triggers/constraints (extending today's `relationship_dedup_guard`), so a path that forgets the helper — or a raw SQL/MCP write — still cannot create the row. A `pair_key` that is family-based and direction-independent gets a unique index, making duplicates structurally impossible without imposing one-person-only romantic cardinality.

### Layer 3 — Continuous reconciler + human review for the ambiguous cases

A `profile-lint` routine (runnable per person, and nightly for all) that scans and classifies every violation:

- **Auto-repaired, no confirmation** (provably safe and reversible): mirrored duplicate edges, generic-vs-specific collapse, junk labels, self-edges, value==label junk, synonym-label duplicates.
- **Queued to Review Queue** (needs your judgement): unresolved evidence conflicts, suspected duplicate people (Brigitte/Mum, the three Xihuis) with a one-click merge, and facts that look wrong but might be right. A second partner on a different person is not a violation and is not queued merely because another partner or spouse exists.
- **LLM used only as an auditor**, never as a writer: it may propose `delete` / `relabel` / `merge` with a reason and gets rate-limited and credit-gated; every proposal still passes Layer 2 before it can land.

Every auto-repair writes an entry that can be rolled back, reusing the existing normalization rollback path.

### Layer 4 — Read side cannot display a mess

`RelationshipsSection` renders **one tile per person per semantic relationship**, perspective-correct and gendered ("Wife: Xihui" on your page, "Husband: Michael" on hers). It keeps valid relationships with multiple people visible. The status summary must not silently turn "spouse + partner" into a monogamous conclusion: it should reflect the stored evidence neutrally, and any explicit exclusivity contradiction gets an inline "Resolve" chip.

A small **profile health indicator** on each person shows outstanding violations and links to the queue, so quality is visible rather than assumed.

## Why this one will hold

- Deterministic rules do the enforcing; the LLM can only suggest.
- Four independent layers — vocabulary, application gate, database constraint, render collapse — so one gap is not a failure.
- The DB layer means *no writer can bypass it*, which is exactly what broke every previous attempt.
- Verification is measurable: a lint query that must return **zero** violations across all your data, plus a fixture test suite built from the real rows above (your 23 relationship items and the duplicated fact labels) asserting the exact expected end state.

## One-time cleanup of existing data

A migration + backfill run that: collapses mirrored edges, deletes blocked/self edges, folds generic roles, merges synonym facts, deletes junk values, and files the remaining ambiguous items (spouse conflict, duplicate people) into the Review Queue. Expected result on your profile: **23 items → about 12**, each one a distinct person with one sensible role.

## Technical notes

- New shared module `profile-integrity.ts` (mirrored frontend/edge), replacing scattered logic in `relationship-canonical.ts` / `profile-canonical-schema.ts` / `profile-dedup.ts` — those stay as the vocabulary source, the new module owns enforcement.
- Migration: family-based `relationship_pair_key`, unique index on it, extended `relationship_dedup_guard`, new `profile_entries` value-quality trigger, `profile_lint_violations` view.
- New edge function `profile-lint` (per-person + nightly cron, background execution, credit-aware).
- Frontend: `RelationshipsSection` grouping rewrite, health indicator, Review Queue support for `resolve_relationship_conflict` and `merge_duplicate_person`.
- Rollout order: vocabulary → gate + triggers → backfill → reconciler → UI, verifying the lint count after each step.
