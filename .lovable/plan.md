

# Make AI Chat usable while editing notes

## Three issues, three fixes

### 1) Stop blurring the note while chatting
The FAB chat opens a full-screen `bg-background/60 backdrop-blur-sm` overlay that covers the note and the entire app. Result: while chatting, you can't see what you're working on.

**Fix**: Convert the FAB chat from a centered overlay into a non-blocking docked panel.

- Remove the `fixed inset-0 ... backdrop-blur-sm` overlay entirely.
- Keep the chat anchored bottom-right, same width/height, but with no backdrop and no click-outside-to-close.
- Close happens only via the X button, the FAB toggle, or `Escape`.
- The note (and the rest of the page) remain fully visible and interactive while the chat is open.
- Add a subtle drop shadow so the panel still reads as floating UI.

### 2) Make the chat actually edit the current note (and show it)
The Edge Function `note-chat` already supports note-modifying tools (`append_to_note`, `update_note_metadata`, `update_note_tags`, `add_wikilink`) and writes directly to the DB with the service role. The side-panel `NoteChatPanel` correctly invalidates the notes query and re-hydrates the editor when this happens.

The **FAB chat does not** — it never refreshes the editor or invalidates queries, so the agent's writes stay invisible until you reload.

**Fix**: Wire the FAB chat into the same refresh path as the side panel.

- After every assistant turn, inspect `data.tool_results` for any of the modifying tool names.
- When detected and `noteId` is present:
  - invalidate the React Query `notes` key so the list refreshes
  - dispatch a new lightweight DOM event `menerio:note-updated` with `{ noteId }`
- In `NoteEditor.tsx`, listen for `menerio:note-updated`. When the event matches the currently open note, re-fetch its `content`, `tags`, `metadata` and re-hydrate the TipTap editor exactly the way the side panel already does today (using `markdownToHtml(normalizeNoteContent(...))`).
- This means the user sees AI edits appear live — no manual refresh, no "please reload" message from the agent.

Also: the FAB sends `note_id` only when the URL matches `/dashboard/notes/:id`. Keep that behavior — but make sure the badge in the chat header makes the active mode obvious ("Editing: <note title>" vs "Knowledge Base").

### 3) Stop losing chat history; keep the conversation alive across reloads and route changes
Today the FAB stores messages in component state and clears them whenever the URL changes context. So:
- refreshing the page wipes the conversation
- navigating from one note to another wipes the conversation
- going from a note to the dashboard wipes the conversation

**Fix**: Persist conversation history per context, with a sliding window sent to the model.

Storage:
- Persist messages in `localStorage` under a versioned key, namespaced by user and context:
  - `menerio:chat:v1:<userId>:<contextKey>`
  - `contextKey` = `note:<noteId>` for note chats, `general` for the knowledge-base chat
- On open, hydrate from `localStorage`. On every message change, write back.
- Cap each context at the last ~200 messages stored locally to keep `localStorage` healthy.

Cross-tab and cross-mount continuity:
- Because state lives in `localStorage`, refreshing the page restores history.
- Switching from note A back to note A later restores history for that note.
- Switching from note A to note B switches to note B's history without wiping note A's.

Sliding window sent to the model (this is the "compression" requirement):
- Keep all messages locally, but only send a window to `note-chat`:
  - always keep the most recent **N** turns (default: last 12 messages, ~6 user/assistant pairs)
  - prepend a short auto-generated **conversation summary** of everything older than that window
- The summary is produced lazily client-side: when the local history exceeds the window, call `note-chat` with a one-shot "summarize" instruction (or, simpler and cheaper: a small dedicated branch in the function — see "Edge Function" below) and store the resulting summary alongside the messages under the same key.
- After each new exchange, if the window has grown past the threshold again, refresh the summary so older context keeps getting folded in.

Result:
- The agent never "forgets" earlier topics — they survive as a rolling summary.
- Token usage stays bounded regardless of how long the conversation runs.
- Refreshing the page or switching notes preserves both the visible history and the summary.

Add a small "Clear conversation" action in the chat header so the user can intentionally start over.

## UX details

- Chat header shows the active context: note title (when in a note) or "Knowledge Base".
- A small "history saved" indicator (e.g. a tiny dot or message count) so the user knows messages persist.
- "Clear conversation" lives in a header overflow menu, with a confirm step.
- When AI writes to the note, the assistant's reply still says what it did, but no longer asks the user to refresh — because the editor updates live.

## Files to update

| File | Change |
|---|---|
| `src/components/chat/GlobalAIChatFAB.tsx` | Remove backdrop overlay; persist messages in `localStorage` per context; load history on open; dispatch `menerio:note-updated` after note-modifying tool calls; invalidate `notes` query; sliding-window + summary when sending; add "Clear conversation" action |
| `src/components/notes/NoteEditor.tsx` | Listen for `menerio:note-updated`; on match, re-fetch the note and re-hydrate the editor (reuse the existing logic from the side-panel `onNoteChanged` block) |
| `src/components/notes/NoteChatPanel.tsx` | Apply the same persistence + sliding-window + summary behavior so the in-editor side panel stays consistent with the FAB |
| `supabase/functions/note-chat/index.ts` | Add a lightweight `summarize` mode (or accept an optional `prior_summary` field) so the client can request/refresh a compact summary of older turns without changing the existing tool-calling flow |
| (no schema changes) | History lives in `localStorage`; no DB tables needed |

## What this does not change
- The Edge Function's tool-calling loop, credit accounting, and RLS model stay the same.
- Notes remain stored as Markdown in the DB.
- The in-editor side-panel chat (`NoteChatPanel`) keeps working; it gets the same persistence + summary upgrades for consistency.
- No new dependencies.

