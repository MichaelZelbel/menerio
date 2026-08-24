# Search: a real relevance score, not tiers plus recency

## What actually goes wrong with "ownward s"

The note titled exactly **Ownward Studio** (id `5647e…`, last edited 2026-08-17) does exist and is not trashed. There are 10 non-trashed notes whose title contains "ownward s", so the note *is* fetched — it is not a truncation problem this time.

It loses on ranking. In the current scorer (`src/lib/search-terms.ts`), every one of those 10 notes lands in the same tier ("title contains the query phrase"), because a 92-character journal headline like `2026-07-27 D-052: Ownward Studio gets a publisher's mark…` contains "ownward s" just as literally as the 14-character title `Ownward Studio` does. Once the tier ties, the tie-breakers tie too (same term count, same phrase hit), and the last tie-breaker is **recency** — the journal notes were all re-saved on 2026-08-21, the real note on 08-17. So it sorts 11th and the dropdown only shows 8 rows.

The design flaw is structural: coarse tiers + recency as the decider. Nothing in the score says "this query is basically the whole title" vs "this query is 15% of a long sentence title".

## The fix: one scoring function, coverage-aware

Replace the tier ladder with a single numeric score that every search surface shares. Components, all computed on normalized text (diacritics stripped, whitespace collapsed, lowercased):

1. **Title exact match** — top of the list, nothing outranks it.
2. **Title prefix / word-start match** — the query begins the title, or begins a word in the title.
3. **Coverage** — `matched characters / title length`. This is the piece that is missing today and the piece that fixes this bug: "ownward s" covers 64% of `Ownward Studio` and 12% of the journal headline, so the short, precise title wins by a wide margin regardless of edit dates.
4. **Match position** — a hit at character 0 beats a hit buried after a date prefix.
5. **Term coverage** — fraction of query terms found in the title, then in the body.
6. **Body-only matches** score in a band strictly below any title match.
7. **Recency** — a tiny final tie-break only, never able to overturn a coverage or position difference.

Additional correctness work in the same pass:

- **Live typing / prefix terms.** "ownward s" currently drops the trailing "s" (tokens under 3 chars are discarded), so the shape of what the user typed is lost. The last token of a query is treated as a *prefix* term instead of being dropped — matching how an incremental search box is actually used.
- **Typo tolerance.** The user's vault has both "Onward" and "Ownward" spellings. Add a bounded edit-distance fallback (Levenshtein ≤ 1 for terms of 5+ characters, ≤ 2 for 8+) that only runs when the strict pass finds no title match, so it can never dilute exact results.
- **Candidate set guarantee.** Keep the two-pass fetch, but add a dedicated exact/prefix-title probe (`title.ilike.<q>` and `title.ilike.<q>%`, limit 5) that always runs. Even with thousands of matching notes, the exactly-titled one is in the candidate set.
- **Trash duplicates.** Several titles exist as both a live and a trashed copy; confirm the trashed ones are excluded on every path (they already are in the remote fetch; the local-replica path uses `is_trashed = 0`).
- **Display.** The dropdown shows 8 rows; raise the keyword portion so at least the top 3 keyword title matches always survive the merge with semantic results.

## Where it applies

The scorer lives in `src/lib/search-terms.ts` and is used unchanged by all five surfaces, so they can never drift again:

- header search (`DashboardSearch.tsx`)
- Notes page search (`Notes.tsx` via `useIlikeSearch`)
- `[[` wikilink autocomplete
- link-a-note picker (`NoteSearchInput.tsx`)
- command palette

## Technical notes

- `src/lib/search-terms.ts`: `extractSearchTerms` gains prefix-term handling; `matchTier`/`rankNotesByTerms` are replaced by `scoreNote(note, query, terms) → number` plus a thin `rankNotesByTerms` wrapper that keeps the existing call signature. `isTitleHit` becomes "title score band" so `pinTitleHits` keeps working.
- `src/hooks/useNotes.ts`: add the exact/prefix title probe to `fetchKeywordCandidates` and the same to `searchNotesLocal` (SQLite path already orders by `length(title)`, which stays as a cheap pre-filter).
- `src/components/layout/DashboardSearch.tsx`: reserve slots for keyword title hits in `mergeStable` so a late semantic pass cannot fill the list before the exact title is appended.
- Tests in `src/lib/__tests__/search-terms.test.ts` using the real data shape from this bug: `Ownward Studio` must rank first for `ownward`, `ownward s`, `Ownward Studio`, and (via the typo fallback) `onward studio`, against the eight newer journal titles that contain the same phrase.
- Verification: run the vitest suite, then reproduce in the preview by typing `ownward s` in the header search and confirming `Ownward Studio` is the first row.
