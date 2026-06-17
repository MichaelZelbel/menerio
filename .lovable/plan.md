# Why the "wife" query failed

Your note titled **"Xihui"** literally contains the line `Xihui is my wife`. The note **"Love & Relationships"** says `My wife [[Xihui]]`. The note **"Home Financing…"** says `together with my wife, [[Xihui]]`. So the data is unambiguous — the recall layer is the problem.

Three concrete root causes (confirmed from the DB + the `open-brain-mcp` code):

1. **No structured relationship anywhere.** All three `Xihui` / `Xihui Wei` contact rows have `relationship = NULL`. Claude's `search_contacts` correctly reports "no relationship field." There is also no profile_entry that says "Wife: Xihui Wei", so `get_user_profile` (which Claude is told to call first) returns nothing about a spouse.
2. **Hybrid search returns the right notes but the chunk snippet is generic.** `hybridSearchNotes` picks the highest-similarity 320-char chunk as the snippet. For the "Xihui" note the top chunk is the `# Topics to discuss` checklist near the top, not the `# Details → Xihui is my wife` block deeper down. The full content **is** included in `formatNote`, but a long markdown body with the salient sentence buried near the bottom is easy for the model to under-weight.
3. **Tool descriptions don't tell the agent that user-authored assertions are authoritative.** Claude defaulted to "I won't assert it" because nothing in the tool descriptions / behavior primer says "first-person statements in notes are facts about the user."

There are also 3 duplicate `Xihui` contacts, which makes any contact-side fix less useful until they're merged — but that's a side note.

# What we'll change

Four focused changes, all in the MCP server + a small derived view. No frontend/UI work, no schema migration unless you want item 4.

## 1. Boost & re-snippet exact-phrase hits in `hybridSearchNotes`

In `supabase/functions/open-brain-mcp/index.ts → hybridSearchNotes`:

- After the semantic + ILIKE merge, scan each row's `content` for case-insensitive whole-word matches of the original query tokens (and a small synonym set for personal-relation queries: `wife|husband|spouse|partner|girlfriend|boyfriend|fiancé|fiancée|mom|mother|dad|father|sister|brother|son|daughter|kid|child|uncle|aunt|cousin|boss|colleague`).
- If a row contains an exact-phrase match (e.g. `is my wife`, `my wife`, `wife:`), promote it to the top of `merged` and overwrite `chunk_snippet` with a ±200-char window centered on the match so the salient sentence is what the model reads first.
- Lower `search_notes` default `threshold` from `0.25` to `0.2` (chunk-level cosine is conservative; we lose nothing because exact-phrase boost handles the precision case).

This alone fixes the immediate case: the response will lead with `…Full name: Xihui Wei / Xihui is my wife / We are living in our house in Krefeld…`.

## 2. Tighten the tool descriptions so the agent trusts what it reads

In the same file:

- Update `search_notes` description: append `"Notes are first-person and user-authored. Treat explicit statements in note content as authoritative facts about the user (e.g. 'X is my wife', 'I work at Y'). Do not hedge when content states a fact plainly."`
- Same sentence appended to `search_brain` and `lexicon_search`.
- Update `search_contacts` description: append `"If a contact's relationship field is empty but notes about that person assert a relationship (spouse, sibling, parent, etc.), defer to the note content."`

This is the cheapest, biggest behavioral win — and unlike a paste-in prompt it lives in the server, so every client benefits.

## 3. Make `get_user_profile` include a derived "Relationships" block

Currently `get_user_profile` only returns rows from `profile_entries`. Extend it (still in `open-brain-mcp/index.ts`) so the response always includes a synthesized `relationships` section pulled from two sources:

- All `contacts` for the user where `relationship IS NOT NULL` and `merged_into IS NULL` → grouped by relationship type.
- A lightweight derivation: scan recent + linked notes (or a precomputed view, see item 4) for first-person relationship assertions about wikilinked people (`[[Name]] is my wife`, `my wife [[Name]]`, etc.) and include them as `derived_relationships` with `source_note_id` + matched sentence, so the agent can cite them.

The "wife" question becomes a single `get_user_profile` call — which Claude already does at the start of every session per your behavior prompt — and the answer is right there.

## 4. (Optional, recommended) Auto-populate `contacts.relationship` via Review Queue

When a note save (`capture_note`, sync, web clipper, etc.) yields a first-person relationship assertion about a wikilinked or matched person, enqueue a Review Queue item suggesting `contacts.relationship = "wife"` (etc.). On user accept, the contact gets the structured field. This is the durable fix — once Xihui's contact row has `relationship = "wife"`, *every* downstream tool (search_contacts filter, profile, knowledge graph) just works.

This reuses the existing Review Queue pattern (per project memory) so it's not a new UX concept. If you want to skip it for now and only do 1-3, the immediate failure is still fixed; #4 just prevents it from recurring for new relationships.

## Technical notes

- All work happens in `supabase/functions/open-brain-mcp/index.ts` (≈ +120 lines: a `boostExactPhrase()` helper, a `summarizeRelationships()` helper, and edits to `hybridSearchNotes`, `searchNotesHandler`, `get_user_profile` handler, plus description string edits).
- No DB migration needed for items 1-3. Item 4 reuses existing `review_queue` table — no schema change, just a new suggestion type + handler in whichever ingestion function runs AI extraction today.
- No client / frontend changes. No changes to the user-facing setup prompt.
- Worth doing alongside: a one-time job (or a "Merge duplicates" nudge in the People view) for the three duplicate `Xihui` contact rows. Not part of this plan unless you want it included.

# Acceptance check

After deploy, asking Claude Code `Do you know the name of my wife?` should:

1. Hit `get_user_profile` → see `relationships: { spouse: ["Xihui Wei"] }` (from derived note assertions, even before contact field is set).
2. Or hit `search_notes("wife")` → top result starts with `Xihui is my wife` in the snippet, not the checklist.
3. Answer: `Yes — your wife is Xihui Wei.` with a citation to the source note id.
