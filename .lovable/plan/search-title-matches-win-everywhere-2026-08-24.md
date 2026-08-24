# Search: title matches win, everywhere

## What's actually wrong

Confirmed against your data: a note titled exactly **"Ownward Studio"** (folder `Projects/Ownward`, last edited Aug 17) exists and is not trashed. Searching `Ownward Studio` doesn't surface it because:

- Keyword search splits the query into terms (`ownward`, `studio`) and searches title **and** content with the same weight. Over 30 non-trashed notes contain both words in their body.
- Ranking (`rankNotesByTerms` in `src/lib/search-terms.ts`) scores a title hit exactly like a body hit: it concatenates title + content into one haystack, counts matched terms, then breaks ties by `updated_at`.
- The exactly-titled note is older than ~25 of those body matches, and the header dropdown only shows 8 rows — so it is ranked out of view before it ever renders.
- The semantic pass then appends more body-similarity hits into the same 8 slots.

The `[[` wikilink autocomplete was fixed earlier with its own local title ranking, but that fix lives inside `WikilinkAutocomplete.tsx` only. Regular search never got it.

## The sustainable fix

One shared ranking rule used by every note search surface, instead of per-component patches.

**1. Title-first scoring in `src/lib/search-terms.ts`**

Replace the single title+content haystack with tiered scoring, best tier wins:

1. title equals the query (normalized: trimmed, whitespace collapsed, diacritics stripped, case-insensitive)
2. title contains the full query phrase
3. title starts with the query / query terms appear in the title on word boundaries
4. title contains *all* query terms (any order)
5. title contains *some* terms — more terms is better
6. body-only matches, ranked by number of terms and phrase hits (today's behaviour)

Recency stays, but only as a tie-breaker *within* a tier — never as a way for a body match to outrank a title match.

**2. Guarantee the exact-title note is in the candidate set**

Both keyword queries (`useIlikeSearch`, `useSearchNotes` in `src/hooks/useNotes.ts`) fetch 50 rows ordered by `updated_at`, so a matching title can be truncated away before ranking. Add an explicit exact/prefix title condition to the `.or(...)` filter and order the fetch so title matches are never cut, keeping the existing `user_id` / `is_trashed` filters and the `escapeLike` / `ilikeContains` helpers. Same treatment for the offline SQLite path in `searchNotesLocal`.

**3. Keep title hits at the top after the semantic pass**

In `src/components/layout/DashboardSearch.tsx`, `mergeStable` is append-only, so a late-arriving semantic result can't displace a title hit — but a title hit that arrives in the keyword pass must be *first*, not merely present. Pin rank-tier-1/2 rows to the top of the visible list while preserving the existing no-reorder-under-the-cursor behaviour.

**4. Same ranking for the other note pickers**

`src/components/profile/NoteSearchInput.tsx` (link-a-note) and `WikilinkAutocomplete.tsx` both get switched onto the shared ranking, so `WikilinkAutocomplete`'s private `rankNotes` copy disappears and there is one behaviour to maintain.

## Not included

Typo tolerance (fuzzy matching, e.g. finding "Ownward" when you type "Onward") is a separate feature and isn't part of this fix — your query spelled the title correctly, the ranking was the problem.

## Technical notes

- Scoring changes are pure functions in `src/lib/search-terms.ts`, covered by extending `src/lib/__tests__/search-terms.test.ts`: a "title exactly matches" case and a "recent body match must not outrank an older title match" regression case, plus the existing sentence-query tests must keep passing.
- Verification: type `Ownward Studio` in the header search; the note titled `Ownward Studio` must be row one in both the instant and post-semantic states.
