

## Hide Metadata Pills from Note List

### What changes
In `src/components/notes/NoteList.tsx`, remove or hide the entire metadata pills block (the `{hasMetadata && (...)}` section) that renders type, topics, people, and action item count pills.

### Files Modified
- `src/components/notes/NoteList.tsx` — remove the metadata pills rendering block (lines ~119-148), and optionally the `hasMetadata` variable since it's no longer used. The source badges (Slack/Telegram/Discord/Quick) and entity type badge at the bottom can remain or be removed too — user preference.

### Question
Should I also hide the **source badges** (Slack, Telegram, Discord, Quick) and the **entity type badge** (person, event, idea, etc.) at the bottom of each entry, or keep those?

