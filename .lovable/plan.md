
## What I confirmed on live data

- Yumei's contact row exists and has 90+ `profile_entries`, including `Identity & Basics → Date of birth = 2010-05-02` (**no `linked_note_id`** — LLM-inferred, never verified against a note).
- Duplicates in her profile are real: `Favorite food` ×2, `Favorite food/drink` ×1, `Favorite foods` ×2, `Favorite cuisine` ×2, `Favorite drink` ×3, `Nickname` ×4, `Aliases` ×3, `Love language(s)` ×3, etc. Many rows have `linked_note_id = null`, i.e. they were auto-created by `process-note` and never merged.
- Reading the MCP tool code: **no tool returns a contact's `profile_entries`**. `search_contacts` and `get_contact_context` only project the scalar columns on `contacts` (name, relationship, company, notes, last_contact_date, …). `get_user_profile` explicitly filters `contact_id IS NULL` — owner only. So Claire literally cannot see Yumei's stored DOB no matter what it is.

That single gap explains Point A. Points B and C are separate data-quality issues.

## Root causes

1. **A — MCP can't read contact profile facts.** The birthday, favorite food, aliases, etc. all live in `profile_entries` and no MCP tool exposes them. `search_brain` only searches note text/embeddings, so a birthday that lives *only* as a structured fact is invisible to every external LLM.
2. **B — Wrong DOB was accepted.** `Date of birth` is a singleton, but the extractor allows any ISO date that "matches `birthday|born` in source text" (`moment-profile-extraction.ts:108`). A stray "born" mention plus a nearby year → auto-applied. There's no requirement that the date be verbatim in the source or that the source explicitly say "Yumei was born on …".
3. **C — Duplicates.** Two contributors:
   - `SINGLETON_PROFILE_LABELS` covers only canonical singletons from `profile-canonical-schema.ts`. Labels like `Favorite food`, `Favorite drink`, `Nickname`, `Aliases`, `Love language` are treated as multi-valued, so each new note re-adds a variant.
   - The canonical schema doesn't map close variants (`Favorite food` / `Favorite foods` / `Favorite food/drink` / `Favorite cuisine` / `Favorite dish`) to one canonical label before dedup runs, so `entryKey` never collides.
   - The notes-aware normalizer exists but has never been run on Yumei since Phase B/C landed, and its LLM step is conservative for list-valued fields.

## Plan

### 1. Add contact-profile visibility to MCP (fixes Point A for every LLM)

Edit **only** `supabase/functions/open-brain-mcp/index.ts`:

- In `get_contact_context`, after fetching the contact, also fetch `profile_categories` + `profile_entries` where `contact_id = contact.id AND visibility_scope != 'private'`, grouped by category, and append a `## Profile` section (`Category → label: value`). Cap at ~40 entries.
- Extend `search_contacts` to include a compact `profile_summary` line per hit: pull a small allow-list of high-value labels (`Date of birth`, `Nickname`, `Aliases`, `Ethnicity`, `Relationship`, `Location`) into the result text.
- Add a new tool `get_contact_profile` (mirrors `get_user_profile`, but takes `name` or `contact_id` and only returns the contact's own `profile_entries`, respecting `is_sensitive` / `ai_visibility` via existing helpers). This gives LLMs an explicit "look up person X's structured facts" tool.

All three read the same `profile_entries` table the app already uses, apply the existing `applyVisibility` / `redactSensitiveContact` helpers, and change no schema.

### 2. Tighten DOB extraction (prevents new bad birthdays)

Edit `supabase/functions/_shared/moment-profile-extraction.ts`:

- Remove the "computed ISO date from `birthday|born`" bypass for `Date of birth`. Require one of: (a) an explicit `YYYY-MM-DD` or unambiguous natural date **verbatim in the source**, plus the person's name within ±80 chars, OR (b) an "Nth birthday on <date>" phrase attributed to that specific person.
- When the fact is `Date of birth` and confidence < 0.9, force `status = pending_review` (never auto-apply).

### 3. Fix the existing wrong DOB (data repair, one-off)

After code changes deploy, run:
- `normalize-profile` with `{ scope: "contact", contact_id: "cf9b5d76-…", includeNotesContext: true }`. The notes-aware pass should see the "Thursday, September 29, 2005" note and either flag the current 2010-05-02 entry as conflicting or propose replacement. Report the review-queue items for Michael to accept.

### 4. Collapse Yumei's (and everyone's) profile duplicates (Point C)

Two-part fix in `supabase/functions/_shared/profile-canonical-schema.ts` + `profile-normalization.ts`:

- **Canonical schema:** add alias mappings so the deterministic pass folds variants into one canonical label:
  - `Favorite food` ← `favorite foods`, `favorite food/drink`, `favorite dish`, `favorite cuisine`
  - `Favorite drink` ← `favorite drinks`, `favorite beverage`
  - `Nickname` ← `nicknames`, `name aliases`, `aliases` (kept as list value, not singleton)
  - `Love language` ← `love languages`
  - `Ethnicity` ← `ethnic background`
- **List-valued canonical labels:** introduce a `LIST_VALUED_LABELS` set (Favorite food, Favorite drink, Nickname, Aliases, Love language, Favorite desserts, …). For these, the deterministic collapser merges all entries into one canonical row whose value is the **de-duplicated union** of comma-split tokens (case-insensitive, trims trailing punctuation). Old rows go into the rollback snapshot as usual.
- Then run `normalize-profile` with `{ scope: "all_contacts" }` (already background-safe via `EdgeRuntime.waitUntil`).

### 5. Make note-based birthday findable via `search_brain` (Point B, retrieval side)

Small addition to `open-brain-mcp` `search_brain` result formatting: when the query contains `birth|birthday|born|dob|geburts`, boost/keep note chunks whose text matches `\b(19|20)\d{2}\b` near a month name or ISO date, so the birthday note ranks above generic mentions. No new tables; done as a post-filter reranking on already-returned chunks.

### Verification (after build mode)

1. Call `get_contact_profile { name: "Yumei" }` via curl of the MCP function — expect `Date of birth` in the response.
2. Re-run `normalize-profile` for Yumei; confirm exactly one `Favorite food`, one `Nickname` (list value), one `Date of birth` in review queue or applied.
3. Ask Claire through Telegram: "What is Yumei's birthday?" — she should now get the DB value; once #3 replaces it, the correct 2005-09-29.

### Files touched

- `supabase/functions/open-brain-mcp/index.ts` (contact profile tools + search rerank)
- `supabase/functions/_shared/moment-profile-extraction.ts` (DOB guard)
- `supabase/functions/_shared/profile-canonical-schema.ts` (aliases + list-valued set)
- `supabase/functions/_shared/profile-normalization.ts` (list-valued merger in deterministic pass)
- Redeploy: `open-brain-mcp`, `process-note`, `normalize-profile`

No DB migrations, no frontend changes.
