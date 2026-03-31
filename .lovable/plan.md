

## View and edit AI-generated metadata (topics, people, type) in the Note Editor

### What you're seeing
The tags in the sidebar (topic pills like `#career`, person pills like `@Sarah`, type badges like `meeting note`) are **AI-generated metadata** extracted automatically when a note is processed. They come from the `metadata` JSONB column, not the manual `tags` array.

Currently in the editor, this metadata is only visible in a small read-only info popover (the `i` button). There's no way to edit it.

### What we'll build
Add a visible, editable **metadata panel** below the editor toolbar showing AI-extracted metadata with the ability to add, remove, and edit entries.

### Changes

**`src/components/notes/NoteEditor.tsx`**
- Add a collapsible metadata bar (always visible when metadata exists, toggled via the existing info button or a new "Tags" button)
- Display topics as editable pills with X to remove, plus an input to add new topics
- Display people as editable pills with X to remove, plus an input to add new people  
- Display type as a dropdown to change the note classification
- Display sentiment as a small indicator
- Display summary as an editable one-line text field
- Display action items as a checklist
- All edits write back to the `metadata` JSONB column via `updateNote.mutate`

### UI layout
```text
┌─────────────────────────────────────────────┐
│ Title input                                 │
├─────────────────────────────────────────────┤
│ Editor toolbar                              │
├─────────────────────────────────────────────┤
│ ▸ Smart Tags                                │  ← collapsible section
│  Type: [meeting_note ▾]  Sentiment: 😐      │
│  Topics: #career #planning [+ add]          │
│  People: @Sarah @Mike [+ add]               │
│  Summary: "Discussed Q3 goals..." [edit]    │
│  Action items: ☑ Follow up with Sarah       │
├─────────────────────────────────────────────┤
│ Manual tags: tag1 × tag2 × [+ add]         │
├─────────────────────────────────────────────┤
│ Editor content area                         │
└─────────────────────────────────────────────┘
```

### Technical details
- Create a new component `NoteMetadataEditor.tsx` to keep `NoteEditor.tsx` manageable
- Props: `metadata: Record<string, unknown>`, `onUpdate: (metadata) => void`
- The `onUpdate` callback merges changes into the existing metadata and calls `updateNote.mutate({ id, metadata: merged })`
- Type dropdown options: observation, task, idea, reference, person_note, meeting_note, decision, project
- Topics/people use an inline input with Enter to add, X button to remove
- Collapsed by default if no metadata exists; auto-expanded when metadata is present
- The existing "Classify" button remains for triggering AI extraction on unclassified notes

