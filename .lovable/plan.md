# Fix: AI refuses to append because the note "changed"

## What is actually happening

The in-note AI has an optimistic-concurrency guard. When the chat turn starts, the editor tells the server the note's last known `updated_at`. Before any write, the server reloads the note and refuses if the row's `updated_at` moved more than 1 second past that base:

`supabase/functions/_shared/note-edit-tools.ts` → `error: "stale"` → the model then asks you to confirm.

The check looks at the row timestamp, not at the text. A brand new note like "Discord" gets several server-side writes right after creation — AI metadata extraction, smart title, embedding, wiki/lexicon jobs — and each of those bumps `notes.updated_at` without changing a single character of your content. So the guard fires even though nothing you wrote changed, and even though an append cannot destroy anything.

## The fix

Make the guard about content loss, not about timestamps.

1. Stop blocking pure appends. `append_to_note` (and `insert_into_note` with `at: "end"`/`"start"`) only adds text; it can never clobber existing content. These tools skip the staleness check entirely and always write on top of the freshly reloaded content.
2. Content-aware check for the risky tools. `replace_in_note` and anchored `insert_into_note` (with `after_text`) keep a guard, but it triggers only when the note text actually differs from what the client had at turn start — not when only the timestamp moved. The client sends a hash of the content it was showing; if the hash matches the current content, the write proceeds silently.
3. Keep the deletion guard as is. Any write that would remove more than the allowance of existing text is still refused without `confirm_delete`. That is the protection that matters.
4. Tighten the model's instructions so it stops asking for permission on plain "add this" requests: when the user asks to add/describe/append, call `append_to_note` directly instead of narrating a proposal.

## Technical detail

- `supabase/functions/_shared/note-edit-tools.ts`
  - `NoteEditSession` gains `baseContentHash?: string`.
  - Replace the timestamp condition with: skip for append/unanchored insert; for replace/anchored insert, refuse only when `baseContentHash` exists and does not match the hash of the currently loaded content. If no hash was supplied, fall back to today's timestamp comparison so nothing regresses.
  - Simple stable hash over the normalized content (djb2/FNV over the raw string) — no crypto needed.
- `supabase/functions/note-chat/index.ts` — accept `base_content_hash` from the request body and pass it into `createNoteEditSession`.
- `src/components/notes/NoteChatPanel.tsx` — send `base_content_hash` computed from the editor's current content alongside `base_updated_at`. Same for the global chat FAB path if it edits notes.
- `src/lib/note-ai-edit.ts` — small shared `hashNoteContent()` helper so client and server use the same algorithm.
- `supabase/functions/_shared/llm-defaults.ts` — adjust the note-chat system prompt: act on explicit add/append requests, only ask for confirmation when a change would remove or rewrite existing text.

## Result

Asking "add a description of Discord and links" writes straight into the note. Confirmation still appears only when the AI would actually overwrite or delete text you wrote.
