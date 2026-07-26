## The problem

`DashboardSearch` runs two searches per keystroke: a fast keyword (ILIKE) pass, then a slower semantic pass. The rendered list is `[...semanticResults, ...remaining ilikeResults]` — so when the semantic pass returns, the whole list is **re-sorted and prepended to**. Every row shifts, and a click in flight lands on a different note. A "Semantic results" header is also injected at that moment, pushing everything down one more row.

## The fix: append-only, position-stable result list

1. **Keep a single ordered result list per query.** Instead of deriving the render list from two arrays, maintain one `orderedResults` array keyed by note id:
   - When the ILIKE pass returns, seed the list in its order.
   - When the semantic pass returns, **only append ids not already present**, and merge extra data (similarity score, match_source) into rows already displayed *in place* — never reorder.
   - Reset the list only when the query text changes (new debounce cycle), not when a slower pass lands.

2. **Reserve the row height / drop the shifting header.** Remove the conditional "Semantic results" section header that appears mid-flight. Instead, mark semantically-matched rows with the existing sparkle icon and the `%` badge, which occupy space already allocated in the row.

3. **Freeze the list while the pointer is over it.** Even append-only can surprise a user if the container scrolls. When the mouse is inside the dropdown (`onMouseEnter`) or a row has keyboard focus, buffer any pending list update and apply it on `onMouseLeave`. This guarantees the row under the cursor never changes identity.

4. **Guard against out-of-order responses.** Track a request id (incrementing counter) for each debounce cycle; discard any ILIKE/semantic response whose id is stale, so a slow response from an earlier query can't repopulate the list.

5. **Single loading affordance.** Keep the spinner visible until *both* passes for the current query settle, so the list never looks "done" while more is coming. Optionally show a subtle "refining…" line at the bottom of the dropdown so added rows are expected.

## Technical notes

- All changes are contained in `src/components/layout/DashboardSearch.tsx`.
- Replace `ilikeResults` / `semanticResults` / `useMemo` merge with a single `results` state plus a `pendingResults` ref used for the hover freeze.
- Row identity stays keyed on `r.id`, so React reuses DOM nodes and no reconciliation flicker occurs when a row's similarity score is filled in.
- No backend, query, or search-logic change — ranking semantics are unchanged, only presentation order stability.
