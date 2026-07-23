
## Why the current guard missed "Spiderman" and "Geum Sung-je"

The note "Yumei" is a personal contact profile — it's not primarily *about* a work of fiction, so `content_mode` came back as `personal` and the whole-note fiction guard didn't trigger. But inside that note the following sentences appear:

- `"Where did I see the character I remind you of? Spiderman?"` — Spiderman is a fictional superhero.
- `"favorite actor Lee Junyoung as Geum Sung-je"` — Geum Sung-je is the *role* Lee Junyoung plays in the K-drama *Weak Hero*, i.e. a fictional character.

Both were included by the LLM in `metadata.people` despite the prompt saying not to, and there is no *per-name* filter after that — the guard is all-or-nothing at the note level.

**Yes, this is fixable.** The fix is to stop trusting a single note-level flag and instead evaluate each new proposed name individually before it becomes a review-queue item.

## Plan — three complementary layers, all in `supabase/functions/process-note/index.ts`

Only the person-suggestion path is affected. No frontend changes, no schema changes.

### 1. Deterministic per-name context filter (fast, free)

Before creating an `add_contact` suggestion for a name that isn't in Contacts, look at the sentence(s) around each mention in the note text and drop the name when it clearly reads as fictional. Concretely, skip the name if any of these apply:

- The name matches a small hard blocklist of iconic fictional characters (Spiderman/Spider-Man, Batman, Superman, Naruto, Goku, Pikachu, Mario, Luigi, Zelda, Link, Kirito, Sailor Moon, …). This list ships in code and is easy to extend.
- Within ~120 chars of the mention we see fiction-role cues: `\b(as|playing|voiced by|plays|role of|character|protagonist|antagonist|villain|hero(?:ine)?|main lead|OC|fictkin|kin)\b`, or the mention is inside a `[[wikilink]]` that resolves to a Lexicon page tagged as work/character.
- The mention appears in a bulleted "favorite/watching/reading/playing" list (`favorite (show|movie|anime|manga|game|character|actor)`, `currently (watching|reading|playing)`, `cast:`, `starring`) — indicative of media, not a real contact.
- The `add_alias` path already gates on `scorePersonMention`; extend that gate to also fail on the fiction cues above for both `add_contact` and `add_alias`.

This alone would have caught both examples: "as Geum Sung-je" is preceded by "actor Lee Junyoung as", and "Spiderman?" appears right after "the character I remind you of".

### 2. LLM verification pass for the residual (cheap, tiny model)

For any candidate name that survives layer 1 *and* would create a new `add_contact` suggestion (not a fuzzy alias match), run one small batched classification call per note:

- Input: the list of candidate names + the note title + a short excerpt (±200 chars around each mention).
- Output: `{ name, verdict: "real_person" | "fictional_character" | "unclear" }[]`.
- Only names verdicted `real_person` continue to the review queue. `unclear` is dropped by default (safer than adding a fictional character).
- Model: same tiny model used elsewhere in `process-note` (routed through the existing `runChat` / Lovable AI Gateway path). Uses existing credit accounting; one call per note, only when there are new-person candidates.

### 3. Strengthen the metadata prompt (belt & suspenders)

In `METADATA_SYSTEM_PROMPT` (the section describing `"people"` around line 645), add a short explicit example: *"Exclude character names even when the note is a personal profile that references media — e.g. `favorite actor X as Y` → `Y` is a fictional role, do not include."* And add a matching negative example. This nudges the extraction pass itself so layers 1 & 2 have less to clean up.

## Cleanup of the two stuck items

After the fix ships, the two existing `pending_review` rows for "Spiderman" and "Geum Sung-je" will still be there. Either you dismiss them manually, or I can delete just those two `review_queue` rows for your user in a one-off data change. I'll ask before doing that.

## Files touched

- `supabase/functions/process-note/index.ts` — extend the person-suggestion loop with layer-1 filter + layer-2 verification, update metadata prompt.

That's it. No new tables, no new edge functions, no UI changes.

## Honest caveats

- Layer 2 is an LLM call, so it can still occasionally misjudge (e.g. a real person who happens to share a name with a fictional character). Because we default `unclear` to dropped, false negatives (a real contact not suggested) are possible — you can still add them manually from the person's page. This is the right tradeoff versus the current failure mode of adding Spiderman to your People.
- Very obscure fictional characters with no context around the mention may still slip through layer 1; layer 2 catches most of these.
