## Goal

One predictable duplicate action across content types: same label ("Make a copy"), same icon (`Copy`), same placement, same result — a fresh unsynced draft named `<Title> 1`, opened immediately, never linked to external sync.

## Current state (verified)

- Notes: `useDuplicateNote` in `src/hooks/useNotes.ts` — Obsidian-style " N" title suffix, copies content/tags/folder/structured fields, stamps `metadata.duplicated_from`, resets pinned/favorite/trashed and sync fields. Exposed only in `NoteTree.tsx` context menu ("Make a copy", `Copy` icon). The note editor's ⋯ menu has "Copy to clipboard" / "Copy note link" but no duplicate (except a special "Duplicate to edit" button for synced/read-only notes).
- Collection items: `CollectionDetail.tsx` table row menu has a "Duplicate" item (no icon, different wording). The new tree context menu (`CollectionItemsTree.tsx`) and the inline item detail view have no duplicate action.
- Moments: `TimelinePage.tsx` drawer only offers "Edit Moment"; no duplicate anywhere.
- People: no duplicate anywhere.

## UX decision

**Placement rule (two spots, always the same two):**
1. Right-click context menu of the item in its tree/list — under the favorite/move block, above the destructive block.
2. The ⋯ overflow menu in the detail/editor header — in the same "Copy to clipboard / Copy link" group, as the first entry of that group.

**Wording & icon:** always `Copy` (lucide) + "Make a copy". Rename the collection table's "Duplicate" to match.

**Behavior contract (shared):** copy is created in the same container (folder / collection / date), title gets the ` N` suffix via the existing `nextDuplicateTitle` helper, favorite/pin/trash reset, external sync identity dropped, `duplicated_from: <source id>` recorded in metadata, success toast "Made a copy", and the new item is selected/opened so the user lands in the copy.

**People: deliberately excluded.** A contact is an identity, not a document. The app actively fights duplicate people (merge dialog, duplicate hints, fuzzy auto-link, dedup triggers), so a copy button would manufacture exactly the state those systems clean up. Instead, People keep "Merge". If you still want it, the sane variant is "New person from this as template" — say the word and I'll add it.

## Implementation

**1. Shared helper — `src/lib/duplicate-entity.ts` (new)**
- Move `nextDuplicateTitle` out of `useNotes.ts` (re-export from there to avoid touching note logic) so all types share the exact suffix rules.
- Export `MAKE_A_COPY_LABEL = "Make a copy"` for consistent wording.

**2. Note editor — `src/components/notes/NoteEditor.tsx`**
- Add a "Make a copy" `DropdownMenuItem` (`Copy` icon) in the ⋯ menu above "Copy to clipboard", wired to `useDuplicateNote()`.
- Before duplicating, flush any pending autosave (the existing pending-save ref/flush path) so the copy contains the latest text, then navigate to `/dashboard/notes/<new id>`.
- Leave the existing "Duplicate to edit" banner for synced notes as-is.

**3. Collection items — `src/pages/CollectionDetail.tsx` + `src/components/collections/CollectionItemsTree.tsx`**
- Refactor the existing `duplicateItem` to use the shared title suffix (instead of whatever it currently appends), preserve `folder_id`, field values and item type, reset favorite, record `duplicated_from`, then select the new item in the URL-driven detail view.
- Add `onDuplicateItem` to the tree's handlers and render "Make a copy" (`Copy` icon) in the item context menu, above the Delete separator.
- Add the same entry to the inline item detail header ⋯ menu.
- Relabel the table row action from "Duplicate" to "Make a copy" and add the `Copy` icon.

**4. Moments — `src/pages/TimelinePage.tsx`**
- Add a `duplicateMoment` handler: insert a new `moments` row copying title (suffixed), description, `happened_at`/`happened_end`, impact and confidence levels, with `source: "manual"`, `status` reset to the default manual status, and `duplicated_from` in metadata; then copy `moment_participants` rows for the new moment. `moment_provenance` is deliberately **not** copied — provenance belongs to the original extraction.
- Surface it in the moment drawer next to "Edit Moment" as a ⋯ menu with "Make a copy", and in the timeline row context menu if one exists (otherwise add the ⋯ trigger on the row).
- Invalidate the timeline query and open the copy's edit dialog so the user can adjust the date right away.

**5. Consistency pass**
- Grep for remaining "Duplicate" labels on user-facing item actions and align them to "Make a copy" + `Copy` icon.

## Notes / trade-offs

- Moments copy participants but not provenance, so a duplicated moment reads as user-authored rather than AI-extracted — this keeps the review/audit trail honest.
- Duplicated notes still trigger the existing wiki-ingest path when long enough (unchanged behavior); collection items and moments do not gain new AI processing.
- No database migration is needed; all three types already have the columns required.
