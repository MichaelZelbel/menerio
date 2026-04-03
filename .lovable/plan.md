

# Read-Only Notes: Simplified Toolbar UX

## Problem
External (read-only) notes still show the full editor toolbar (bold, italic, headings, etc.) even though the editor is not editable. This is confusing and wastes space.

## Solution
When a note is external (`note.is_external`), replace the `EditorToolbar` with a minimal read-only bar containing:
1. **"Open in {source_app}"** button — opens the note in the originating app via `source_url`
2. **"Duplicate to Menerio"** button — creates a new local, editable copy of the note

## Changes

### `src/components/notes/NoteEditor.tsx`

**Line 596** — Replace the toolbar conditional:
- Currently: `{!note.is_trashed && !sourceMode && <EditorToolbar editor={editor} />}`
- New logic: if `note.is_external`, render a simple bar with two buttons instead of `EditorToolbar`

**Duplicate handler** (new function in the component):
- Creates a new note via `createNote.mutateAsync({ title: note.title, content: editor.getHTML() })` with the same tags
- Navigates to the new note
- Shows a success toast

**Read-only bar layout:**
```text
┌──────────────────────────────────────────────────────┐
│ 🔒 Read-only · Synced from {source_app}   [Open in {app}] [Duplicate] │
└──────────────────────────────────────────────────────┘
```

### No other files need changes
- `EditorToolbar.tsx` — unchanged
- `ExternalNotePanel.tsx` — unchanged (still available in the collapsible details section below)

