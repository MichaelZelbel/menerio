## Root cause — why the AI doesn't know you're married to Xihui

I verified this against your actual database. The wiki page is not the bottleneck. The real chain of failures is:

**1. Relationship facts are extracted only once, per note, at ingest time.**
Profile/relationship extraction lives inside `process-note` and only runs when a note is first ingested. Old notes are never re-extracted, even after we improve the prompt or switch models. Your richest evidence is in notes ingested months ago (long before the relationship-extraction prompt existed in its current form).

**2. Extraction is gated by `metadata.people` from a single early LLM call.**
If that first metadata pass doesn't list "Xihui" in `metadata.people`, the whole profile/relationship extraction is skipped for that note. I confirmed this in your DB:

- `Marriage Papers Xihui and Michael` → `matched_people = null`. The note is mostly an image of the certificate plus the line "Wedding day 2006-01-23, Düsseldorf". The metadata pass didn't tag Xihui, so extraction never ran.
- `Love & Relationships Strategy` ("his wife, Xihui, and two online girlfriends…") → `matched_people = null` as well.
- `Love & Relationships` ("My wife [[Xihui]]") → Xihui *is* matched, but the note was processed before today's relationship logic and was never re-run.

**3. "Self" is almost never recognised as a participant.**
`metadata.people` rarely contains "me"/"Michael"/"I", so `is_self` is not set, and self-↔-contact relationships ("my wife Xihui") are filtered out before they ever reach the relationship extractor.

**4. There is no person-level synthesis pass.**
Nothing in the system ever asks: *"Given everything we know about Xihui (all notes, attachments, moments, lexicon), what relationship does she have to the user?"* Each note is treated in isolation; nothing aggregates evidence across the corpus.

**5. The Review Queue history confirms it.**
Across your entire history there has never been a single `add_relationship` suggestion for spouse/wife between you and Xihui — only the Rick "lover" ones (which came from a Moment, not from notes).

So the AI doesn't "fail to comprehend" — it never reads the evidence together in the first place.

## The fix — person-level evidence synthesis

Instead of patching one note at a time, add a real **person enrichment pass** that aggregates *all* evidence about a contact and asks an LLM to infer profile facts and relationships, including self-↔-contact ones. Then keep the per-note path as a cheap incremental signal.

### 1. Replace the current "Enrich from notes & timeline" with a true synthesis function

Rewrite `enrich-person-from-lexicon` into `enrich-person` that, for a given contact:

- Pulls the **full evidence bundle**:
  - All notes where the contact is matched OR whose title/content contains the contact's name or aliases (regex/ILIKE, not only `matched_people`) — this catches the Marriage Papers note.
  - All Moments referencing the contact.
  - All Media OCR/extracted_text from attachments in those notes (you already have `media_analysis.extracted_text`) — this catches the actual marriage certificate image.
  - Lexicon/wiki pages linked to the contact.
  - The user's own self-context (preferred name, aliases) so "me/my wife" can be resolved.
- Sends one structured LLM call with the **whole bundle** plus instructions:
  - "You are reasoning about <Contact>. The note author is <Self/aliases>. Extract profile facts and relationships, including self-↔-contact ones. A note titled 'Marriage Papers' or text 'my wife X' or a 'Wedding day' moment is direct evidence of a spouse relationship."
- Returns: facts (categorised) + relationships with confidence.

### 2. Auto-apply high-confidence facts, queue the rest

- For `spouse`/`partner`/`parent`/`child` style relationships with confidence ≥ 0.85 and grounded in ≥ 2 distinct pieces of evidence (e.g. a marriage-papers note + a wedding moment), **insert directly** into `contact_relationships` (using the canonical pair-key we already added) and log a Review Queue entry marked "auto-applied, click to undo".
- Lower-confidence ones go to the queue as today.

### 3. Fix the metadata gate in `process-note`

- Remove the hard dependency on `metadata.people`. After the metadata pass, also do a deterministic scan of the note for wikilinks `[[Name]]`, exact contact-name matches, and alias matches; merge into `matchedPeople`. This means the Marriage Papers note alone would have triggered relationship extraction.
- Always include "self" in `matchedPeople` when the note contains first-person language (`I`, `my`, `me`, `mein`, `ich`) or the user's preferred name.

### 4. Backfill once for the existing corpus

A one-shot job (`backfill-person-enrichment`) iterates every contact and runs the new synthesis function. After this runs, Xihui's spouse relationship — and many similar ones for other people — will appear without manual action.

### 5. Repair the immediate state

Verify the manual `spouse` row we inserted for you + Xihui is still there and surfaces on her profile after the new enrichment runs (it will naturally re-create it if missing).

### Out of scope on purpose

- No new tables.
- No changes to the wiki pipeline beyond *reading* lexicon pages as one more evidence source.
- The per-note suggestion flow stays as a cheap incremental signal; the synthesis function is the authoritative path.

### Technical notes

- Reuse `relationship-canonical.ts` and the symmetric unique index already in place.
- LLM: keep DeepSeek v4 Flash via OpenRouter; the bundle is small enough (notes truncated to first ~2k chars each, max ~20 notes, plus media extracted_text).
- Self-context already exists via `loadSelfContext` — reuse it.
- Cost control: the synthesis call only runs on explicit user trigger ("Enrich from notes & timeline") and during the one-shot backfill; not on every note edit.
