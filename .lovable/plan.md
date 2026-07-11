# Improve the Global AI Assistant panel

Two focused fixes to `src/components/chat/GlobalAIChatFAB.tsx` plus a small shared markdown tweak. No backend / edge function changes.

## 1. Size modes — docked, expanded, fullscreen

Add a size state (`"docked" | "expanded" | "fullscreen"`) persisted to `localStorage` so it survives reloads. Header gets two new icon buttons next to the close button:

- **Expand / Collapse** (`Maximize2` / `Minimize2`) — toggles between `docked` and `expanded`.
- **Fullscreen** (`Expand` icon) — toggles fullscreen overlay.

Size mapping (replaces the hardcoded `w-[min(420px,...)]` + `height: min(500px, ...)`):

| Mode        | Width                              | Height                              | Position                     |
| ----------- | ---------------------------------- | ----------------------------------- | ---------------------------- |
| docked      | `min(420px, calc(100vw - 48px))`   | `min(560px, calc(100dvh - 80px))`   | fixed bottom-right (current) |
| expanded    | `min(720px, calc(100vw - 48px))`   | `min(85dvh, calc(100dvh - 80px))`   | fixed bottom-right           |
| fullscreen  | `calc(100vw - 32px)`               | `calc(100dvh - 32px)`               | fixed inset with 16px margin, subtle backdrop |

On viewports < 768px, force `docked` → full-width bottom sheet (already close to that; just widen to `calc(100vw - 24px)`), and hide the "expanded" button (fullscreen still available). Uses `useIsMobile()` from `@/hooks/use-mobile`.

Escape key already closes the panel — extend it so Escape first exits fullscreen → expanded → docked before closing, so the user can step back down.

## 2. Fix markdown readability

Root cause: the FAB overrides prose spacing with `[&>p]:mb-1 [&>p:last-child]:mb-0`, and defines its own bare `ReactMarkdown` instead of using the shared `chatMarkdownComponents`.

Changes:

- Remove the `[&>p]:mb-1 [&>p:last-child]:mb-0` overrides. Use `prose prose-sm dark:prose-invert max-w-none` with default prose spacing (paragraphs, lists, and headings get proper vertical rhythm).
- Extend `src/lib/chat-markdown.tsx` with heading, paragraph, list, and code overrides so headings inside a chat bubble render at reasonable in-bubble sizes regardless of what level the model emits:
  - `h1` → `text-base font-semibold mt-3 mb-1.5`
  - `h2` → `text-sm font-semibold mt-3 mb-1`
  - `h3` → `text-sm font-medium mt-2 mb-1`
  - `ul`/`ol` → tight list with `my-1.5 pl-5 space-y-1`
  - `p` → `my-1.5 leading-relaxed`
  - `code` (inline) → `px-1 py-0.5 rounded bg-background/40 text-[0.85em]`
  - `pre` → `my-2 p-2 rounded bg-background/40 overflow-x-auto text-xs`
- Point `GlobalAIChatFAB` at the shared `chatMarkdownComponents` + `chatMarkdownPlugins` (already used by `people/conversation/ChatMessages.tsx`). This gives the assistant chat table support and consistent typography across all chat surfaces.

Also bump the assistant bubble's max width in expanded/fullscreen modes: change `max-w-[85%]` on assistant messages to `max-w-[85%] md:max-w-[75ch]` so long paragraphs get a comfortable reading measure instead of stretching across a 700px window.

## 3. Layout polish while we're in there

- Give the messages area `px-4 py-4` in expanded/fullscreen (currently `p-3`) for a less cramped feel at larger sizes.
- Textarea grows from `max-h-[120px]` → `max-h-[200px]` in expanded/fullscreen so multi-line prompts are easier to author.
- Header keeps its current compact size in all modes; only the body/composer breathe.

## Files touched

- `src/components/chat/GlobalAIChatFAB.tsx` — size-mode state, header buttons, dimensions, escape-key ladder, use shared markdown config, remove p-spacing override, wider assistant bubble in large modes.
- `src/lib/chat-markdown.tsx` — add heading / paragraph / list / code component overrides. This also improves the People → Conversation chat which already uses this file.

## Not in scope

- No changes to the `note-chat` edge function, system prompt, or streaming behavior.
- No changes to `people/conversation/Chat.tsx` layout — that surface already has a fullscreen dialog. (The shared-markdown improvements benefit it automatically.)
- No new persistence beyond a single `localStorage` key `menerio:chat-fab-size`.

## Verification

- Open the FAB on `/dashboard/people/:id`, click Expand → panel grows to ~720px wide with proper heading/paragraph spacing on the existing "Quick Options" answer.
- Click Fullscreen → overlay fills the viewport with 16px margin; Esc steps back to expanded, then docked, then closes.
- Reload → size mode persists.
- Mobile viewport (375px) → only docked + fullscreen buttons appear; panel fills width.
- People → Conversation Meni chat still renders correctly with the new markdown component overrides.
