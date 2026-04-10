

## Replace Quick Capture FAB with Global AI Chat Button

### Overview
Replace the QuickCapture floating action button with an AI Chat button that opens a chat panel. On note pages, it provides note-specific context. On all other pages, it acts as a general knowledge base assistant (search-only tools, no note-modifying tools).

### Changes

#### 1. New component: `src/components/chat/GlobalAIChatFAB.tsx`
- A FAB button (bottom-right, same position as QuickCapture) with a Bot icon
- Clicking opens a chat panel (slide-up card, similar to QuickCapture's overlay style but taller)
- Uses `useLocation` to detect if on `/dashboard/notes/:noteId` -- if so, passes `noteId` to the edge function
- On non-note pages, calls `note-chat` with `note_id: null`
- Maintains conversation state internally; resets when navigating to a different page context
- Keyboard shortcut: reuse Cmd+Shift+K
- The chat panel UI reuses the same message rendering pattern from `NoteChatPanel` (markdown, tool results indicators)

#### 2. Update edge function: `supabase/functions/note-chat/index.ts`
- Make `note_id` optional (currently required, returns 400 if missing)
- When `note_id` is null/missing:
  - Use a different system prompt: general knowledge base assistant (no "current note" context, no note-modifying tools)
  - Only expose search tools: `search_notes_semantic`, `search_notes_text`, `search_media_text`
  - Remove `append_to_note`, `update_note_metadata`, `update_note_tags`, `add_wikilink` from available tools
  - Skip fetching note content and media analysis
- When `note_id` is provided: existing behavior unchanged

#### 3. Update `DashboardLayout.tsx`
- Replace `<QuickCapture />` with `<GlobalAIChatFAB />`

#### 4. No changes to existing `NoteChatPanel.tsx`
The in-editor AI chat panel (opened from the note sidebar) remains as-is. The global FAB is a separate, independent chat interface.

### Technical Details

| File | Change |
|------|--------|
| `src/components/chat/GlobalAIChatFAB.tsx` | New component: FAB + overlay chat panel |
| `supabase/functions/note-chat/index.ts` | Make `note_id` optional; conditional tools & prompt |
| `src/components/layout/DashboardLayout.tsx` | Swap `QuickCapture` for `GlobalAIChatFAB` |

### UX
- FAB: Bot icon, same styling/position as current QuickCapture button
- Panel: slides up from bottom-right, ~420px wide, ~500px tall, with message list + input
- Empty state: "Ask me anything about your knowledge base" (general) or "Ask me about this note" (note context)
- Close via X button, Escape key, or clicking backdrop

