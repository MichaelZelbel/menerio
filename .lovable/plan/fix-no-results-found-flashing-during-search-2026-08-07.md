# Fix "No results found" flashing during search

## What's wrong

The header search dropdown opens the moment you type, but the actual query only fires 250ms later (debounce). In that gap — and again between keystrokes — the component has no results and is not yet marked as searching, so it renders the final-state message "No results found". You see a definitive "nothing found" while the search hasn't even started, then results appear afterwards.

The same happens on slower passes: the keyword pass and the semantic pass run one after another, and any window where the visible list is empty but work is still queued shows the wrong message.

## The fix

Treat "search in progress" as anything from the first keystroke until both passes for the current query have settled, and only show the empty-state message when that is true.

1. Introduce an explicit search status for the current query: `idle` → `pending` (typed, debounce not elapsed) → `running` (requests in flight) → `done`.
2. Set the status to `pending` synchronously in the input's onChange, so there is never a frame where a typed query is treated as finished.
3. Only render "No results found" when status is `done` and the result list is empty.
4. While `pending` or `running` with no results yet, show a searching state: spinner plus "Searching your notes…" (and keep the existing "Refining results…" footer when results are already visible and the semantic pass is still running).
5. Keep the existing request-ID guard so a stale query can never flip the status to `done` for a newer one.

## Perceived-speed improvements (same change)

- Shorten the debounce from 250ms to ~150ms so the fast keyword pass starts sooner.
- Show skeleton rows instead of a bare text line while the first pass is running, so the dropdown doesn't visibly jump from empty to populated.
- Keep the existing hover-freeze and append-only merge behaviour untouched — result rows must still never move once rendered.

## Technical notes

All changes are contained in `src/components/layout/DashboardSearch.tsx`. The boolean `isSearching` is replaced by a `status` state variable; `setVisible`/`commit`/`mergeStable` logic stays as is. No backend, hook, or query changes — search speed itself is unchanged, only the reporting of its state.
