

## Merge `note.tags` with `metadata.topics` in Note Metadata Section

### What's changing
- Remove the tags pills row from above the note text (lines 582-606 in NoteEditor.tsx)
- In the NoteMetadataEditor, merge `note.tags` into the Topics row alongside AI-extracted topics
- The "add topic" input in Note Metadata will also add to `note.tags` (and vice versa)
- Removing a merged tag removes it from both `note.tags` and `metadata.topics`
- The toolbar Tag button will still work — it will scroll to / focus the topic input in Note Metadata

### Files Modified

| File | Change |
|------|--------|
| `src/components/notes/NoteEditor.tsx` | Remove the tags display block (lines 582-606). Pass `note.tags`, `addTag`, `removeTag` as props to `NoteMetadataEditor`. Keep `showTagInput` state and pass it too, so the Tag toolbar button opens the input in Note Metadata. |
| `src/components/notes/NoteMetadataEditor.tsx` | Accept new props: `tags`, `onAddTag`, `onRemoveTag`, `showTagInput`. In the Topics row, render a unified list: AI topics as `#topic` badges + user tags as `#tag` badges (visually identical). The "add topic" input adds to both `metadata.topics` and calls `onAddTag`. Removing a badge removes from both sources. |
| `src/pages/SharedNote.tsx` | No change needed — shared notes can keep showing tags as-is since they don't have the metadata editor. |

### Behavior details
- Duplicate entries (tag exists in both `note.tags` and `metadata.topics`) are deduplicated in display
- Adding a topic via the input adds it to both `metadata.topics` and `note.tags`
- Removing a topic removes it from both
- The Note Metadata section now always shows if there are tags OR metadata (so tags alone will make it appear)

