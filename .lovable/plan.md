

## Migrate Note Storage from HTML to Markdown

### Why
- Notes are currently stored as HTML in the database, then converted to Markdown for GitHub/Obsidian sync and back again on import — a lossy round-trip
- Edge functions (process-note, note-chat) receive HTML and must strip tags before LLM processing
- The `tiptap-markdown` extension is already installed and configured in the editor, so the capability exists today

### What Changes

**1. NoteEditor.tsx — Save as Markdown instead of HTML**
- Replace all `editor.getHTML()` calls with `editor.storage.markdown.getMarkdown()` for saving to the database (~6 locations)
- The `tiptap-markdown` extension already handles loading markdown via `setContent()` — TipTap's markdown extension auto-detects content format, so loading existing HTML content will still work during the transition

**2. note-content.ts — Update normalizeNoteContent**
- Simplify `normalizeNoteContent` since new content will be markdown, not escaped HTML
- Keep backward compatibility: if content contains HTML block tags, pass through as-is (for old notes)
- Update `getNotePreviewText` to handle markdown content (strip markdown syntax instead of HTML tags)

**3. GitHub sync export (github-sync-export/index.ts)**
- Remove the `htmlToMarkdown()` conversion on line 210 — content is already markdown
- Add a fallback: if content looks like HTML (contains `<p>` tags), still convert (for old un-migrated notes)

**4. GitHub sync import (github-sync-pull, github-import-vault)**
- Remove `markdownToHtml()` conversion — store the markdown body directly
- Keep frontmatter parsing as-is

**5. Edge functions (process-note, note-chat)**
- Remove the `stripHtml` workaround just added — content will be plain markdown, which LLMs handle natively
- For backward compatibility, keep a lightweight strip if HTML tags detected

**6. Shared note rendering (get-shared-note, SharedNote.tsx)**
- The shared note page renders HTML directly — will need to convert markdown to HTML for display, or use a markdown renderer component

**7. Data migration — backfill existing notes**
- Create a one-time edge function `backfill-markdown` that:
  - Selects all notes where content contains HTML block tags
  - Converts each to markdown using the existing `htmlToMarkdown()` utility
  - Updates the content column
- Run in batches to avoid timeouts

### Migration Safety
- The `tiptap-markdown` extension's `setContent()` accepts both HTML and markdown, so during the transition period, old HTML notes will still render correctly in the editor
- The backfill can run asynchronously — no downtime required
- GitHub export adds a format check: if content is already markdown, skip conversion

### Files Modified
- `src/components/notes/NoteEditor.tsx` — switch getHTML → getMarkdown
- `src/lib/note-content.ts` — update preview/normalize for markdown
- `supabase/functions/github-sync-export/index.ts` — skip HTML→MD conversion
- `supabase/functions/github-sync-pull/index.ts` — skip MD→HTML conversion  
- `supabase/functions/github-import-vault/index.ts` — skip MD→HTML conversion
- `supabase/functions/process-note/index.ts` — remove stripHtml workaround
- `supabase/functions/note-chat/index.ts` — no change needed (markdown is fine for LLM context)
- `src/pages/SharedNote.tsx` — add markdown rendering
- New: `supabase/functions/backfill-markdown/index.ts` — one-time migration

