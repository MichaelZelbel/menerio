# Fix: `[[` note search doesn't surface the exactly-titled note

## What's happening

The `[[` autocomplete (`src/components/notes/WikilinkAutocomplete.tsx`) queries notes with:

- `title ilike '%<query>%'`
- `order by updated_at desc`
- `limit 15`

So the ordering is purely "most recently edited", not "best title match". With many notes whose titles contain "Michael" (e.g. wiki/lexicon-style pages), the note actually titled **Michael** — if it hasn't been edited recently — falls outside the 15 rows and never renders.

The bogus "Create: Michael" row is a direct consequence: the create option is shown when no *returned* row has an exactly matching title. Since the real note was truncated away, the component believes it doesn't exist.

Unverified: I could not query the database this turn (the Supabase workspace binding is currently not authorized), so the "there are >15 recently-updated notes containing Michael" part is inferred from the code, not confirmed against data. The first implementation step confirms it.

## Fix

1. **Relevance ranking instead of recency.** Fetch candidates, then sort client-side:
   1. exact title match (trimmed, case-insensitive, whitespace/diacritics normalized)
   2. title starts with the query
   3. word-boundary match inside the title
   4. any other substring match
   Ties broken by `updated_at desc`.

2. **Guarantee the exact match is in the candidate set.** Run the search as a single request using an `.or(...)` filter combining an exact-title condition and the contains condition, and raise the fetch limit (e.g. 50) while still rendering ~15 rows. This way truncation can never hide the exact-title note.

3. **Only offer "Create" when the title truly doesn't exist.** Base the create option on the exact-match branch of the query result (and hide it while a request is in flight), not on whatever subset happened to render.

4. **Small UX touches:** debounce typing (~150 ms), ignore out-of-order responses via a request id, and show a subtle "Exact match" ordering so the correct note is always the pre-selected first row (Enter links it immediately).

## Technical notes

- Only `src/components/notes/WikilinkAutocomplete.tsx` changes; the trigger plugin, node and resolver stay as-is.
- Query built with the existing `escapeLike` / `pgOrValue` / `ilikeContains` helpers from `src/lib/postgrest.ts` so `%`, `_`, `,` and `(` in titles stay literal.
- Keeps existing `user_id` and `is_trashed = false` filters.
- Verification: type `Michael` in the editor after `[[`; the note titled exactly "Michael" must be the first row and the "Create" row must disappear.
