## Problem

When you wrote a note about the Japanese novel *Nekopara*, `process-note` extracted the character names (Chocola, Vanilla, Coconut, …) into `metadata.people` and then queued them as **add_contact** suggestions. The pipeline has guards for products/tools/brands and for hallucinated names, but nothing tells it that a name inside a *work of fiction* is not a real person.

## Fix — teach the extractor about fiction (two layers, both in `supabase/functions/process-note/index.ts`)

### Layer 1 — Prompt: don't put fictional characters in `people`

Extend `METADATA_SYSTEM_PROMPT` (around line 643) so the `people` field explicitly excludes fictional characters from any narrative work — novels, light novels, manga, anime, games, films, TV shows, comics, plays. Add a companion field `mentioned_works` so those titles are still captured as topics/lexicon material rather than silently dropped.

Also add a new top-level metadata field:

```
"content_mode": "personal" | "review_of_fiction" | "review_of_nonfiction" | "reference"
```

The model sets `review_of_fiction` when the note is clearly discussing a novel/anime/game/etc. as its primary subject (as your Nekopara note does — it literally names it as a Japanese novel).

### Layer 2 — Code: skip person suggestions when the note is about fiction

In the `add_contact` / `add_alias` generation loop (around lines 891–1028), before iterating over `people`:

- If `metadata.content_mode === "review_of_fiction"`, skip the whole loop for `add_contact` and `add_alias`. Log the reason. Any names that slipped through go to `mentioned_works`/topics only, not to People.
- Belt-and-braces: also skip when the note text contains a strong fiction cue near a name — e.g. the note mentions "novel", "light novel", "manga", "anime", "visual novel", "game", "movie", "film", "TV series", "character", "protagonist", "author" within a short window. This catches the case where the LLM misses `content_mode`.

Existing guards (Lexicon check, blocklist, mention-scoring, `nameAppearsInText`) stay as-is — the new checks are additive.

### Layer 3 — Small quality-of-life: rollback learns

When you click **Rollback** on an `add_contact` suggestion, we already suppress that exact name via `suppression_key`. No change needed there, but the fiction guard means you shouldn't have to click rollback in the first place for cases like Nekopara.

## What stays the same

- Menerio remains proactive about adding real people from ordinary notes — the guard only fires when the note is clearly about a fictional work.
- No schema/DB changes. No frontend changes. No new edge function.
- No changes to sensitivity thresholds or auto-apply behavior for anything other than the fiction case.

## Files touched

- `supabase/functions/process-note/index.ts` — prompt update + `content_mode` gate in the contact-suggestion loop.

## Verification

After deploy, re-run `process-note` against the existing *Nekopara* note (via the deployed function) and confirm:
1. `metadata.content_mode === "review_of_fiction"`
2. No `add_contact` / `add_alias` suggestions are created for the character names.
3. The note still gets a title, topics, summary, and any real-person facts about *you* (if present).