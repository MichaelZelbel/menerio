# The AI said it wrote to the note — the note stayed empty

## What actually happened

The AI edit **did** land in the database. The note "Deepseek Harness" contains
236 characters (the description plus the GitHub link), written at 14:49:41.
The open editor never showed it, and still displayed an empty document with
"Saved · 30s ago".

So this is not a failed write and not a lying assistant. It is a **display/
convergence failure between the database and the open editor** — and it is
dangerous: while the editor believes the note is empty, the next keystroke
autosaves an empty document over the AI's text.

The exact reason the editor ignored the update is not yet confirmed. Today the
editor learns about AI edits through a single fire-and-forget browser event
(`menerio:note-updated`), whose whole handler sits inside a `try { } catch {}`
that swallows every error silently, and it can be raced by the note prop that
still carries the pre-edit content. Any one of those can drop the update with
no trace. Rather than guess which one fired this time, the plan first
reproduces it with logging, then removes the whole class of failure.

## Step 1 — Reproduce and confirm (no behaviour change yet)

Drive the real app: open a note, ask the assistant to append text, and capture
console + network. Record which of these is true:

- the chat response contained `note_edit` with the new content,
- the editor received the event for the matching note id,
- the handler threw (currently invisible),
- the editor applied the content and something later reverted it.

That answer decides nothing about the fixes below — they are all needed — but
it tells us which one closes this specific report.

## Step 2 — Stop trusting a single event: verify and converge

Make the outcome of an AI edit a checked fact instead of a hope.

- After any note-modifying chat turn, the chat panel refetches the note row
  and compares the server content with what the editor is showing. If they
  differ, it forces the server copy into the editor. One retry after a short
  delay covers replication lag.
- Remove the silent `catch {}` in the editor's update handler. Failures get
  logged and reported to the chat panel, which then falls back to the refetch
  path above instead of showing a false "done".
- Same treatment in both chat surfaces (the floating assistant and the in-note
  side panel), which today duplicate this logic slightly differently.

## Step 3 — A content watermark so stale copies can never win

The editor currently accepts content from three sources (its own typing, the
`note` prop from the list/single-row queries, and the AI event) with no notion
of which one is newer.

- Track the `updated_at` of the newest content the editor has adopted.
- Any incoming copy older than that watermark is ignored — a stale list row
  can no longer blank a note the AI just filled.
- Autosave refuses to write content derived from a document older than the
  watermark, so the "type once and lose the AI's text" hazard disappears.

## Step 4 — Truthful reporting in chat

The assistant currently states "I've added …" purely because the tool returned
success. Add a confirmation step: the chat panel only renders the success chip
once the note content it just verified actually contains the edit. If
verification fails, the message shows a plain warning with a "Reload note"
action instead of a false confirmation.

## Step 5 — Regression test

Unit-test the convergence rule (watermark comparison, apply-vs-ignore
decisions) so a future refactor cannot silently reintroduce the drift, and
re-run the live scenario from Step 1 to confirm the note visibly fills in.

## Technical notes

- Files involved: `src/lib/note-ai-edit.ts` (event bridge → add a verified
  apply that resolves with the applied content), `src/components/notes/
  NoteEditor.tsx` (watermark ref, non-silent handler, autosave guard),
  `src/components/chat/GlobalAIChatFAB.tsx` and
  `src/components/notes/NoteChatPanel.tsx` (post-edit verification, honest
  success rendering).
- No edge-function or database changes: `note-chat` and
  `_shared/note-edit-tools.ts` already write correctly and already return the
  exact resulting content and `updated_at`.
- The existing flush-before-edit handshake stays as is; it solves the opposite
  race (user text pending while the AI reads) and is unaffected.
