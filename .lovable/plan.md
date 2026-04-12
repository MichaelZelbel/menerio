

## Add Table Management Controls

### Problem
After inserting a table, users have no way to add/remove rows or columns, merge/split cells, or delete the table. The TipTap table commands exist but aren't exposed in the UI.

### Solution
Add a **contextual table toolbar** that appears in the main toolbar area when the cursor is inside a table. This is a horizontal row of small icon buttons for table operations.

### Changes

**File: `src/components/notes/EditorToolbar.tsx`**
- Detect when the cursor is inside a table: `editor.isActive("table")`
- When active, render an additional row of table-specific buttons:
  - **Add row above** / **Add row below**
  - **Add column before** / **Add column after**
  - **Delete row** / **Delete column**
  - **Merge cells** / **Split cell** (when selection spans multiple cells)
  - **Toggle header row** / **Toggle header column**
  - **Delete table** (destructive, styled accordingly)
- All use existing TipTap commands like `editor.chain().focus().addRowAfter().run()`

### UX
- The table controls appear as an additional toolbar row below the main toolbar, only when the cursor is inside a table
- Grouped logically: Row ops | Column ops | Cell ops | Delete table
- Uses lucide icons where available, text labels for clarity on less obvious actions
- Disappears when the cursor moves outside the table

### Scope
One file changed: `EditorToolbar.tsx`. No new dependencies — all commands come from the already-installed `@tiptap/extension-table`.

