

## Rename and Clean Up the Two "Smart Tags" Sections

### Problem
Two sections in the note editor are both labeled "Smart Tags," causing confusion. Additionally, the vault-wide "Classify all notes" button inside the single-note editor is misleading.

### Proposed Changes

**1. Rename the top section from "Smart Tags" to "Note Metadata"**
- File: `src/components/notes/NoteMetadataEditor.tsx`
- Change the collapsible trigger label from "Smart Tags" to "Note Metadata"

**2. Rename the bottom section from "Smart Tags" to "Vault Insights"**
- File: `src/components/notes/NoteEditor.tsx` — update the `SmartTagsCollapsible` header text from "Smart Tags" to "Vault Insights"

**3. Move "Classify all notes" button out of note editor context (optional)**
- Either keep it in "Vault Insights" but clarify the label to "Classify all unclassified notes in vault (10)" so users understand it's vault-wide
- Or remove it from the note editor entirely and place it only on the Notes list page header

### Files Modified
- `src/components/notes/NoteMetadataEditor.tsx` — rename label
- `src/components/notes/NoteEditor.tsx` — rename collapsible header
- Optionally: `src/components/notes/SmartTagsPanel.tsx` — clarify backfill button label

