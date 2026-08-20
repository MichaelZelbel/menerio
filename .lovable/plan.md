# Profiles: one fact per row, filed where it belongs

## What Yumei's profile actually looks like right now

Queried her rows directly. The damage is not subtle:

- **Full name** (899 characters) contains: her names and nicknames, an email address, "Started working at age 14, moved out at 16", "Occupation: System Analyst (work from home) and private bakery service", "Wakes up around 5 AM and cleans house", and a Korean TV show with its cast.
- **Traits** (581 chars) mixes real traits ("shy and anxious") with pronouns, cartoon characters (Korilakkuma, Mamegoma) and aesthetic labels.
- **VRChat** (569 chars) mixes avatar preferences with hardware (Quest 3, router, SteamLink) and a raw Discord user ID.
- **Preferred nicknames** (315 chars) has nicknames plus love languages plus explicit sexual preferences.
- **Pets** contains "Face tracking, Vive 3.0 trackers".
- **Favorite restaurants** (422 chars) is a comma soup of restaurants, dishes, sauces and drinks, with duplicates ("Pão recheado with pepperoni" twice in two spellings).

So there are exactly two failures, and they compound:

1. **A row is a comma-joined bag, not a fact.** Every merge path in the code ends in `union.join(", ")`. Each new note appends to the bag, so bags only ever grow. Nothing can ever be deduplicated, corrected, or deleted at fact level — only whole bags.
2. **Nothing checks that a fact belongs under its label.** Once a bag exists, the extractor keeps dumping loosely-related material into it. "Occupation" ends up inside "Full name" and stays there forever.

Everything built so far (canonical labels, dedup triggers, the audit gate, the normalizer) operates on bags. That is why each fix has produced a tidier bag rather than a correct profile.

## The change

**One fact = one row.** A label is allowed to repeat. "Favorite restaurants" becomes eight rows, not one 422-character string. That single change makes every downstream mechanism work, because dedup, evidence, correction and deletion finally have a unit to act on.

### 1. Rows become atomic
- Every write path stops joining with `", "`. A merge that would produce a multi-value string inserts sibling rows under the same label instead.
- A database check rejects any new value that is a multi-fact string: over a length ceiling, or three-plus comma-separated segments where the segments are not a single enumerable phrase.
- Ordering within a label is preserved so display stays stable.

### 2. Every fact is filed by an admission gate, not by whichever bag exists
Before a fact is stored it must pass, in this order:
- **Atomicity** — it is one claim. A sentence carrying two claims is split into two facts or refused.
- **Label fit** — the fact must be a valid instance of its label's type. An email is not a name. A wake-up time is not a name. Hardware is not a pet. This is a typed check per canonical label (name / identifier / place / date / person / free text), not a prompt instruction.
- **Category fit** — the resolved label must belong to the category being written to.
Facts that pass go in. Facts that fail get re-routed to the correct label when the type check names one unambiguously, and go to Review Queue otherwise. Nothing is written to a wrong label to be cleaned later.

### 3. A one-time explosion of every existing bag
A background job walks all existing entries and, for each multi-fact row:
- Splits it into candidate atomic facts.
- Runs each through the same admission gate, so "Occupation: System Analyst" leaves "Full name" and lands under work, the email lands under communication, the TV show lands under entertainment.
- Deduplicates the resulting facts against what already exists.
- Keeps the original row content in a rollback table, so a bad split can be reverted per person.
Runs per person in the background, reports counts, and is re-runnable.

### 4. Display follows the data
Sections render repeated labels as a single labelled group with one line per fact — which is what the UI already does for bulleted values, minus the parsing hacks. Each fact gets its own delete and edit affordance, so a wrong entry takes one click to remove instead of editing a wall of text.

### 5. Proof it worked
Acceptance checks run against real rows and fail on: any stored value over the length ceiling, any value containing a `Label: value` pattern inside it, any fact whose type contradicts its label, any duplicate fact under one label, and specifically on Yumei's profile — no email or occupation under a name label, no hardware under pets, no love languages under nicknames.

## Technical notes

- `profile_entries` keeps its shape; uniqueness moves from (person, label) to (person, label, normalized value). The existing `trg_profile_entries_prevent_duplicate_fact` token logic is reused as the per-fact dedup key.
- New `_shared/profile-fact-gate.ts`: `splitToFacts()`, `typeOfValue()`, `labelAcceptsType()`, `routeFact()`. Frontend mirror under `src/lib/`, guarded by an existing-style mirror test.
- Replace `join(", ")` merges in `profile-normalization.ts`, `profile-dedup.ts`, and `process-note/index.ts` with sibling-row inserts; drop the accumulator-label concept (`profile_is_accumulator_label`) since every label is now naturally multi-row.
- New edge function action `explode-bags` on the existing normalizer, `EdgeRuntime.waitUntil`, per-contact batches, writing to a `profile_entry_splits` rollback table.
- `ProfileSections.tsx` / `ProfileValue.tsx` group by label and render one row per fact; remove comma-splitting at render time.
- Order: gate module + tests → DB constraint and uniqueness change → writer re-routing → bag explosion job → UI grouping → acceptance suite run on Yumei and two other profiles, output pasted.
