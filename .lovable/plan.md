## Goal

In the People sidebar, remove the separate "Ungrouped" section. Under "All people", show groups first, then people with no group membership — mirroring how the Notes tree lists folders first and then loose notes under its root.

## Current state (verified)

- `buildPeopleTree` in `src/components/people/peopleTreeBuild.ts` returns `{ roots, ungrouped }`. `ungrouped` = active people with no membership to any active group.
- `PeopleTree.tsx` renders three peer sections under Favorites/Recent:
  1. An "All people" expandable that contains only `tree.roots` (groups).
  2. A separate `SectionRow` labeled **"Ungrouped"** using `UNGROUPED_KEY` and the `UserX` icon (lines ~886–902).
- Expansion state, keyboard navigation, and drag/drop all reference `UNGROUPED_KEY`.

## Change

1. **`peopleTreeBuild.ts`** — no shape change needed; keep returning `ungrouped`. (Renaming to something like `looseMembers` is optional; skipping to keep the diff small and tests green.)

2. **`PeopleTree.tsx`**
   - Remove the standalone "Ungrouped" `SectionRow` block.
   - Inside the "All people" expanded body, after rendering `tree.roots.map(...)`, render `tree.ungrouped` as person rows at depth 1 (same indent level the root groups use), reusing the existing person-row rendering path used inside a group (drag source, context menu, bulk select, selection highlight).
   - Empty-state copy: when both `tree.roots` and `tree.ungrouped` are empty, keep a single "No groups yet" line (or switch to "No people yet" if there are also no ungrouped — minor polish).
   - Keep the "All people" count as `people.length` (unchanged — it already reflects the full set).
   - Remove `UNGROUPED_KEY` from the expansion set defaults and from the keyboard-navigation flattener at line ~671 (loose people are now visible whenever "All people" is expanded — gated by `ALL_KEY` instead of `UNGROUPED_KEY`).
   - Drop the `UserX` import if it becomes unused.

3. **Drag & drop**
   - Dropping a person onto empty space inside "All people" (or explicitly onto the loose-people area) should behave like the old "Ungrouped" drop: remove that person from all groups. Wire the existing "remove from all groups" handler to a drop target on the loose-people container (or on "All people" itself when the drag payload is a person, not a group — groups already reparent-to-root on that drop).

4. **Tests**
   - `peopleTreeBuild.test.ts` continues to pass (shape unchanged).
   - `peopleTreeInteractions.test.tsx`: update any assertion that looked for the "Ungrouped" label; add a case asserting loose people render under "All people" when expanded.

## Out of scope

- The Collections tree alignment (next step, after this fix ships).
- Renaming Notes' `VaultRoot` label to "All notes" (mentioned by user as a naming nit; not requested as part of this task).
