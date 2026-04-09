

## Move Vault Insights from Note Editor to Notes List Column

### What's changing
Remove the "Vault Insights" collapsible from the note editor panel and integrate it into the left "All Notes" column as a compact filter toolbar, using Evernote-style flyout menus (dropdown/popover) for Topics, Types, People, and Actions.

### Design
The existing Filter icon button row in the Notes list header already has dropdowns for entity type and sort. We'll add new dropdown buttons for **Topics**, **People**, and **Type** (metadata type) — each opening a scrollable checklist popover. The "Classify unclassified vault notes" button and "Weekly Digest" can go into an overflow menu (the `...` or a Sparkles icon).

```text
┌─────────────────────────────┐
│ All Notes  [Filter▾][Tags▾] │  ← Tags = new dropdown with Topics/People/Type sub-menus
│            [Sort▾][🔍][+]   │
├─────────────────────────────┤
│ Active filters: #ai  ×      │  ← existing filter indicator bar
├─────────────────────────────┤
│ Note list...                 │
```

Each flyout dropdown shows a scrollable list of checkboxes (topics sorted by count, people sorted by count, types with colored pills). Selecting one sets the existing `topicFilter`/`personFilter`/`metaTypeFilter` state that already filters `currentNotes`.

### Files Modified

1. **`src/pages/Notes.tsx`**
   - Add a new "Tags" dropdown button in the header toolbar (next to existing Filter and Sort buttons)
   - Inside: three sub-sections (or a tabbed popover) for Topics, People, and Types — each computed from `allNotes` metadata (reuse the aggregation logic from SmartTagsPanel)
   - Add a "Classify vault" button in the dropdown or as a small action
   - Remove `onTopicClick`, `onPersonClick`, `onTypeClick`, `activeTopicFilter`, `activeTypeFilter` props from the `NoteEditor` call (no longer needed there)

2. **`src/components/notes/NoteEditor.tsx`**
   - Remove the `SmartTagsCollapsible` component and its usage
   - Remove the related props (`onTopicClick`, `onPersonClick`, `onTypeClick`, `activeTopicFilter`, `activeTypeFilter`, `allNotes` for vault insights)
   - Clean up imports (SmartTagsPanel, Tags icon, etc.)

3. **`src/components/notes/SmartTagsPanel.tsx`**
   - Either repurpose into a reusable hook/utility that just computes the aggregated data (topics, people, types, action items, digest), or inline the aggregation logic directly in `Notes.tsx`

### Approach Details
- Use a `Popover` (from shadcn) triggered by a "Tags" button with `Hash` icon
- Inside the popover: three collapsible sections (Topics, People, Types) with scrollable lists and counts
- Each item is clickable to toggle the filter (reusing existing `topicFilter`/`personFilter`/`metaTypeFilter` state)
- The backfill "Classify" button goes at the bottom of the popover
- Weekly digest can become a small summary at the top of the popover or be removed from this view entirely
- Action items section can stay or move — since it's vault-wide, it fits better in the popover too

