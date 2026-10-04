# Profiles show only what can prove itself

## Goal

A person's profile shows a fact only if the fact can prove where it came from. Today every fact the AI ever wrote is shown unless some rule happens to block it. This plan reverses that, at the single place profiles are read, so it covers old facts, new facts and every way facts get in, with no list of junk to maintain.

Success is checked against real data: Yumei's profile is gone through entry by entry with the user before anything is called done.

## Why earlier fixes failed (constraints for the implementer)

- Earlier fixes added blocking rules to individual writers (process-note, Review Queue, enrichment). Old rows never passed through them, and each rule only knew one kind of mistake.
- Do NOT add another rule that rejects a specific kind of bad value. Express everything as a positive requirement a fact has to meet.
- Do NOT delete data. Facts that fail the check are hidden and listed, and stay recoverable.
- "Done" means the acceptance review in Step 7 passes on real rows, not that unit tests pass.

## The rule

A current fact (`claims` row, `valid_to is null`) is **proven** if either:

1. **User-entered:** `origin = 'user_manual'`, or the user confirmed it (see Step 4), or
2. **Quoted evidence about this person:** all of the following hold
   - `evidence_quote` is non-empty and `source_id` points to an existing, non-trashed note or moment owned by the same user;
   - the quote actually occurs in that source (case- and whitespace-insensitive);
   - the value is supported by the quote: the value occurs in the quote, or at least 80% of its words of 3+ letters do. Exception: `date-of-birth` derived from an explicit age phrase that is about the subject (see next point);
   - the quote is about the subject, not the note author: it names the subject (name or alias) or sits in a note whose title is the subject's name, AND the value's own words are not attached to a first-person marker in the quote (`my`, `I`, `me`, `mine`, German `mein/ich/mir`). Example: "Yumei really cared for my 55 birthday" fails for `date-of-birth` because "55 birthday" is owned by "my".

Everything else is **unproven**. `origin = 'unverified'`, and rows with `source_type = 'ai'` and no source, are unproven automatically.

## Implementation steps

### Step 1. One shared predicate

- New module `supabase/functions/_shared/fact-proof.ts`, re-exported from `src/lib/fact-proof.ts` (same pattern as `profile-fact-gate.ts`).
- Exports `factProof(fact, source, subjectNames): { proven: boolean; reason: ProofReason }`, where `ProofReason` is one of `user_entered | user_confirmed | quoted | no_quote | source_missing | quote_not_in_source | value_not_in_quote | about_author | not_about_subject`.
- Pure function, no I/O. Unit tests in `src/lib/__tests__/fact-proof.test.ts` use the real Yumei rows below as fixtures.

### Step 2. Store the verdict in the database

- Migration: add `proof_status text not null default 'unchecked'` (`proven | unproven | unchecked`), `proof_reason text`, `proof_checked_at timestamptz` to `public.claims`.
- Mirror the SQL-checkable parts in a function `public.claim_proof(claims)` for origin, source existence, quote-in-source and value-in-quote. Subject and first-person checks run in TypeScript (Step 3) and write their result into the columns.
- Trigger on insert, or on update of `value`, `evidence_quote` or `source_id`: set `proof_status = 'unchecked'`, except `user_manual`, which is set to `proven` immediately.

### Step 3. Proof worker

- New edge function `prove-facts`, uses `EdgeRuntime.waitUntil`. It loads `unchecked` claims in batches of 200 together with their source text and the subject's name and aliases, runs `factProof`, and writes the result to the three columns.
- Runs after every fact write (call it from `_shared/fact-store.ts` once a write succeeds), plus a `pg_cron` job every 10 minutes through `internal.call_edge`, as a backstop.
- Initial backfill: run it over all existing claims for all users. Log counts per reason.

### Step 4. Read path: the only enforcement point

- Recreate the views `public.profile_facts` and `public.agent_facts` (from `20260929090100_fact_store_schema.sql`) with a `proof_status` column, and filter `agent_facts` to `proof_status = 'proven'`, so AI chat, MCP and exports only see proven facts.
- `profile_facts` keeps returning all rows, with the status, so the UI can show the unproven list. `useFacts` splits them into `facts` (proven) and `unprovenFacts`.
- Every other place that reads `claims` directly (`mc-api-world`, `_shared/agent-facts.ts`, `_shared/claims.ts` callers, `menerio-mcp`) must filter `proof_status = 'proven'`. Add a CI script `scripts/check-claims-reads.mjs` that fails when `from("claims")` is used for reading outside an allowlist (writers and the worker).
- Confirming: a "This is right" action on an unproven fact sets `origin = 'user_manual'` (the trigger then marks it proven). "Wrong" uses the existing remove-plus-suppress path in `useFacts`.

### Step 5. UI

- `ProfileSections` renders only proven facts.
- Each proven AI fact shows a small source link that opens the note at the quote. No new metadata pills; reuse the existing collapsible detail.
- A collapsed card at the bottom of the person's profile and of My Profile: "N unconfirmed details: check these". It lists each unproven fact with its quote and source if it has one, a plain-language reason ("No note backs this up", "This line is about you, not Yumei", "The note doesn't say this"), and the buttons "This is right" and "Wrong".
- Completeness and suggestion widgets count proven facts only.

### Step 6. Writers stop producing fragments (secondary)

These reduce noise but are not what guarantees correctness, because Step 4 does that:
- `_shared/profile-fact-gate.ts` `splitToFacts`: split only on newlines or bullets, or on commas when every part is a short value of at most 4 words with no verbs or brackets. Never split prose. Fixtures: the "Weak Hero, especially Season 2 (Park Hu-min…" line stays one value, and "Happy Meal with nuggets, fries…" stays whole under `favorite-order`.
- `process-note`: send the subject's name with the extraction prompt, and tell the model never to attribute first-person statements to the subject.
- Review Queue "Keep" (`review-queue-bulk` and the single apply path) writes the suggestion's `source_quote` into `evidence_quote`, so kept facts can be proven. If a suggestion has no quote, Keep counts as the user's confirmation (`user_manual`).

### Step 7. Acceptance review (definition of done)

1. Run the backfill. Report the totals: proven, unproven per reason, for all users.
2. For Yumei, produce a table of every current fact: attribute, value, status, reason, quote. Expected results include:
   - hidden: `date-of-birth 1971-09-18` (about_author), the four "answered/messaged with love" rows, `height 145 cm`, `ex-boyfriend`, `makeup-foundation`, `cooking-skill-level` (no_quote), and the fragment rows under `loves-tv-show` and `favorite-order` (value_not_in_quote or fragment);
   - shown: `email`, `employer`, `favorite-games`, `favorite-pokémon`, `medical-procedure` (user_entered), `activity Origami`, `likes-visiting Liberdade`, `loves-doing coloring her hair`, `disliked-food Tofu`, `favorite-foods Popsicles`, `nationality Mixed Japanese/Brazilian` (quoted).
3. Screenshot Yumei's profile page (Playwright, signed-in session) and show it to the user next to the table.
4. Repeat 2–3 for two more contacts with many facts and for My Profile.
5. Not done until the user agrees nothing wrong is visible. Every wrong visible row becomes a failing fixture in `fact-proof.test.ts` before it is fixed.

## Technical notes

- Tables: `claims` (new columns), views `profile_facts` and `agent_facts` recreated. No rows are deleted. Rollback: drop the columns and recreate the views from the previous migration.
- Brand rules apply: UI strings use `BRAND` and the person's name, never hardcoded brand names.
- Record the rule "profiles and agents read only proven claims; writers never decide visibility" in `AGENTS.md`.
- The fact-store plan in `docs/plans/one-fact-store.md` gets a short section pointing at this design, committed to `main`.
