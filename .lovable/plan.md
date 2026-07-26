## What's wrong

Clicking a version in the Version History panel fetches the note's GitHub file at that commit and dumps the first 2000 characters of the **raw file** into a ~200px `<pre>` at the bottom of the sidebar. That raw file starts with YAML frontmatter including a base64 `menerio_metadata` blob — that's the "codes" you saw. It's truncated, unstyled, and unreadable.

## The fix

**1. Full-screen version preview dialog**

Clicking a version opens a large dialog (not the bottom strip):
- Header: version title as it was at that commit, commit short SHA, author, and absolute date + relative time ("14 Mar 2026, 09:12 · 4 months ago").
- Body: the note parsed with `markdownToNote()` (strips frontmatter and the base64 metadata) and rendered read-only through the same `RichTextEditor` used by the note editor — so headings, lists, tables, checkboxes, wikilinks and images look exactly like the note did.
- Scrollable, no 2000-char truncation.

**2. Clear compare / decide affordances**

- A "Current version" ↔ "This version" toggle at the top of the dialog so you can flip between the historical content and today's content in place before deciding.
- Footer actions: **Close** and **Restore this version**.
- Restore asks for confirmation ("Replace the current note with this version? Your current content stays in GitHub history.") before writing.
- After restore: dialog closes, history panel stays open, success toast.

**3. Sidebar list polish**

- Keep the list as the picker; the chevron now genuinely opens the preview.
- Show a loading spinner on the row being fetched, and mark the selected row.
- Show "Current" badge on the newest commit.
- Empty/error states stay as-is but the fetch error becomes an inline retry instead of only a toast.

## Technical notes

Files touched: `src/components/notes/VersionHistoryPanel.tsx` only (plus a small extracted `VersionPreviewDialog` component in the same folder). Uses existing hooks `useGitHubFileAtCommit`, `useSyncLogForNote`, `useUpdateNote`, existing `markdownToNote`, `RichTextEditor` (`editable={false}`, `showToolbar={false}`) and shadcn `Dialog`/`AlertDialog`. No database, edge function, or GitHub API changes; restore keeps its current behaviour of writing title + content via `useUpdateNote`.
