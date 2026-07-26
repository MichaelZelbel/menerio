## Goal

The AI must never lose or duplicate text in a note. Today it can do both.

## What's actually wrong (from the code)

1. **The editor and the agent write to the same note from two sides, blindly.**
   `append_to_note` (`supabase/functions/note-chat/index.ts`) reads `notes.content` from the DB, concatenates, and writes it back. Meanwhile `NoteEditor.tsx` holds the user's text in an 800 ms debounce (`pendingSaveContentRef`) and saves the whole document. Whichever lands last wins — so freshly typed text can be wiped by the agent's write, or the agent's append can be wiped by the editor's next save.

2. **The editor deliberately ignores AI updates while focused.** In the `menerio:note-updated` handler the refresh is skipped when `editor.isFocused`. The chat panel sits next to the editor, so this is the normal case: the editor keeps its stale copy, then autosaves it over the agent's edit.

3. **Nothing prevents the same append happening twice.** `runAgentLoop` executes every tool call the model emits, up to 5 iterations, with no dedupe. If the model repeats `append_to_note` (or retries after an ambiguous result), the same paragraph is written twice — exactly what the screenshot shows.

4. **`append_to_note` is the only editing tool.** There is no way to replace or insert precisely, so the model works around it by appending, and there is no way to undo.

## Plan

### 1. Flush before any AI turn (stops the overwrite race)
- Add a `menerio:flush-note-save` request/ack event pair. `NoteEditor` listens, cancels its debounce, runs `saveContentNow` immediately, and reports the resulting `updated_at`.
- `NoteChatPanel` (and `GlobalAIChatFAB` when a note is open) awaits that flush before calling `note-chat`, and sends the note's `base_updated_at` in the request body.

### 2. Optimistic concurrency on the server
- `note-chat` write tools re-read the note and compare against `base_updated_at`. If the note changed underneath, the tool returns a structured `stale` result telling the model to re-read the note rather than writing a guess. No silent clobbering.

### 3. Precise, non-destructive edit tools
Replace the single blunt append with:
- `append_to_note(text)` — unchanged intent, but idempotent: if the normalized text already appears in the note, it returns `already_present` and writes nothing.
- `insert_into_note(text, after_text | at: "start" | "end")` — anchors on an exact existing snippet.
- `replace_in_note(find, replace, occurrence)` — must match exactly once (or an explicit index), otherwise it errors instead of guessing.
- No tool ever writes a whole-document rewrite.
Every write tool returns `{ before_excerpt, after_excerpt, new_updated_at, chars_added, chars_removed }`.

### 4. Deletion guardrails
- A shared guard rejects any write whose result removes more than a trivial amount of existing text unless the tool is an explicit `replace_in_note` the user asked for; the tool returns a refusal the model must relay.
- Prompt rules in `_shared/llm-defaults.ts` (note-chat note-mode prompt): never remove or rewrite existing user text; append/insert only; if an edit fails, report it instead of retrying with a different shape.

### 5. Dedupe tool calls in the agent loop
- In `runAgentLoop`, key each executed call by `tool + JSON.stringify(args)`; a repeated identical write call inside one turn returns the first result instead of writing again.

### 6. Apply results to the editor directly, even when focused
- `note-chat` returns the note's final `content` and `updated_at`.
- The chat panel dispatches that payload with the `menerio:note-updated` event; `NoteEditor` applies it via `setEditorContentWithAttachments`, updates `lastSavedContentRef` / `lastSavedUpdatedAtRef`, and drops its now-stale pending payload — so the next autosave can't revert it. Cursor position is preserved where possible; focused state no longer blocks the update.

### 7. Undo an AI edit
- Each note-modifying assistant message stores the pre-edit content returned by the server and renders an **Undo this edit** action that writes it back through the normal save path and refreshes the editor.

## Verification
- Type into a note, immediately ask the chat to append — user text and appended text both survive.
- Ask for the same append twice in one turn — appended once.
- Ask it to replace a phrase that appears twice — it reports ambiguity instead of mangling the note.
- Undo restores the exact prior content.
