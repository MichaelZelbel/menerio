## Problem

The note-editor chat ("Mira") returns GitHub-flavored Markdown tables, but they render as a single garbled line. Two root causes:

1. `ChatMessages.tsx` uses `react-markdown` without the `remark-gfm` plugin, so pipe-tables aren't parsed at all — they fall back to inline text and collapse onto one line.
2. Even when parsed, a multi-column table won't fit in the narrow side-panel chat bubble, so we also need a width/scroll strategy and a prompt nudge.

## Fix

### 1. Parse tables (and other GFM) in chat
- Add `remark-gfm` to `react-markdown` in:
  - `src/components/people/conversation/ChatMessages.tsx` (Mira / person chat)
  - `src/components/notes/...` note-chat message renderer (the one used by the in-editor chat — will confirm exact file during build; likely `NoteChatPanel` / `NoteChatMessages`)
  - `src/pages/SharedNote.tsx` for consistency
- Tables (and task lists, strikethrough, autolinks) will then render as real `<table>`.

### 2. Make tables readable in a narrow bubble
- Wrap rendered tables in a horizontally scrollable container and give them compact styling via a custom `components={{ table, th, td }}` map passed to `ReactMarkdown`:
  - `<div class="overflow-x-auto -mx-1 my-2">` around `<table class="w-full text-xs border-collapse">`
  - `th/td`: `border border-border px-2 py-1 text-left align-top`
- This works inside the existing `prose` wrapper without fighting Tailwind Typography.

### 3. Nudge the bot away from wide tables
- Update the note-chat system prompt (in the corresponding edge function, likely `supabase/functions/note-chat/index.ts`) with a short instruction:
  > "You are rendered in a narrow side-panel chat (~320px). Prefer concise bullet lists over Markdown tables. Only use a table when it has ≤3 columns and short cells; otherwise use a list."
- Keep tables allowed (since we now render them), but discourage the 5-column case in the example.

## Technical notes

- `remark-gfm` is the standard companion to `react-markdown` for tables; it's tree-shakeable and already common in this codebase pattern.
- No DB / schema changes. No edge-function logic changes besides the system-prompt string.
- The existing `prose prose-sm` classes already style tables reasonably; the custom component overrides above are just to guarantee horizontal scroll on overflow inside the bubble.

## Out of scope
- Rewriting the chat UI with AI Elements.
- Persisting/streaming changes.

## Files to touch
- `src/components/people/conversation/ChatMessages.tsx`
- `src/components/notes/<note-chat message renderer>` (exact path confirmed at build time)
- `src/pages/SharedNote.tsx`
- `supabase/functions/note-chat/index.ts` (system prompt string only)
- `package.json` — add `remark-gfm`
