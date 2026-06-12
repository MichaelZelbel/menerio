# Fix Orphan Notes list — show all & allow scrolling

## Problem
On `/dashboard/orphans` the list shows only ~5 notes and is neither scrollable nor navigable, even though the header says "Orphan Notes (80)".

Two causes in `src/components/graph/OrphanNotesDetector.tsx`:
1. The full-page branch wraps the list in `<ScrollArea className="max-h-[500px]">`. Inside the page container (which has no fixed height), Radix ScrollArea collapses to a tiny viewport, so only the first handful of items are visible and the inner scrollbar doesn't engage.
2. The list is sliced to `200` items — fine for 80, but we'll drop the artificial cap on the dedicated page anyway.

## Fix
Edit `src/components/graph/OrphanNotesDetector.tsx`:

- Remove the `ScrollArea` wrapper in the non-compact branch. Render the list as a plain `<div className="space-y-2">` so the normal page scroll handles overflow — same pattern as Notes / Review Queue pages.
- Drop the `.slice(0, 200)` cap when `compact` is false; render all orphans.
- Remove the now-unused `ScrollArea` import.

No changes to `useOrphanNotes`, the compact dashboard tile, routing, or styling tokens. Compact tile keeps its top‑5 preview + "View all" link.

## Files
- `src/components/graph/OrphanNotesDetector.tsx` (edit)
