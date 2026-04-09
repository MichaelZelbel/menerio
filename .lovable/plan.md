

## Auto-Link Metadata People to Contacts (with Alias Matching)

### Problem
AI extracts `metadata.people` names from notes, but these are raw strings disconnected from the curated People (contacts) list. The contact matching in `process-note` only checks canonical `name`, ignoring `aliases`. New names go to the Review Queue, but there's no auto-linking for known people.

### What Changes

**1. Improve alias matching in `process-note` edge function**
- When checking if a mentioned person already exists as a contact, also check against `aliases` (not just `name`)
- If a match is found (by name or alias), auto-link: store the contact ID in `metadata.matched_people` so the UI can link mentions to People
- Only create Review Queue "add_contact" suggestions for genuinely unknown names

**2. Same fix in action items contact matching**
- The action items section (lines 293-304) already builds a `contactMap` but only by `name` — extend it to include aliases too

**3. Update the NoteMetadataEditor UI**
- In the People row, if a person name matches a contact (via `matched_people` in metadata), make it a clickable link to `/dashboard/people` with that person selected
- Unmatched names remain as plain text badges

**4. Update the Tags popover aggregation in Notes.tsx**
- The People filter section should merge metadata people with contacts where possible, showing canonical names when an alias match exists

### Files Modified

| File | Change |
|------|--------|
| `supabase/functions/process-note/index.ts` | Fetch contacts with `name, aliases` instead of just `name`. Match extracted people against both canonical name and aliases. Store matched contact IDs in metadata. Only queue unmatched names for review. |
| `supabase/functions/backfill-metadata/index.ts` | Same alias-aware matching if it has similar logic (will check). |
| `src/components/notes/NoteMetadataEditor.tsx` | Render matched people as links to People page; unmatched as plain badges. |
| `src/pages/Notes.tsx` | In the Tags popover, normalize people names using contact aliases when aggregating counts. |

### Technical Details

In `process-note`, the contact lookup changes from:
```typescript
// Before: only checks name
const existingNames = new Set(contacts.map(c => c.name.toLowerCase()));
```
to:
```typescript
// After: checks name + all aliases
const nameToContact = new Map();
for (const c of contacts) {
  nameToContact.set(c.name.toLowerCase(), c);
  for (const alias of (c.aliases || [])) {
    nameToContact.set(alias.toLowerCase(), c);
  }
}
```

A matched person gets stored as `{ name, contact_id }` in `metadata.matched_people`, enabling the UI to link directly.

