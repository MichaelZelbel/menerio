---
name: responsive-design
description: Mobile-friendly responsive layout rules for Menerio — single-pane stacks for multi-pane workspaces, dvh heights, min-w-0, touch targets, safe areas.
---

# Responsive Design

Apply these rules whenever you build or modify a page that should work on phones and tablets, not just desktop.

## Mobile-first defaults

- Design for < 768 px first; add `md:`, `lg:` modifiers to expand for wider viewports. Don't start with a desktop layout and try to retrofit.
- Tailwind breakpoint to use as the mobile/desktop divider: `md` (768 px), matching `useIsMobile()` in `src/hooks/use-mobile.tsx`.

## Multi-pane workspaces — the one-pane rule

If a page has 2+ side-by-side panes on desktop (tree | list | editor, sidebar | content, etc.), it MUST collapse to a single visible pane on mobile. Never let columns shrink so far that content disappears or requires horizontal scrolling.

Two viable patterns:

1. **Stack with back-button navigation** (used in `src/pages/Notes.tsx`): track which pane is active in state. On mobile, render only that pane full-width; provide an explicit back button in the secondary pane's header.
2. **Drawer / Sheet for navigation pane**: keep the primary content full-width on mobile; move tree/sidebar into a `<Sheet>` triggered by a menu button.

Pick (1) when navigation depends on selection (note → editor). Pick (2) when navigation is persistent (filters, settings).

## Viewport height

- Use `100dvh` instead of `100vh`. iOS Safari's address bar shrinks and grows; `vh` causes content to be cut off or overflow.
- Header-offset formula: `h-[calc(100dvh-56px)]` (header is `h-14`).

## Overflow hygiene

- Every flex child that may contain long text needs `min-w-0`. Without it, the child refuses to shrink and pushes siblings out of view — this is the #1 cause of "content hidden off-screen on mobile".
- Only explicit data tables and code blocks may scroll horizontally. Wrap them in `overflow-x-auto`. Everything else should wrap or truncate.

## Touch targets

- Interactive elements: ≥ 40 px tall on mobile. Use `h-9` minimum, prefer `h-10` for primary actions.
- Replace hover-only UI (icon appears on row hover) with always-visible icons or a tap-to-open menu on mobile.

## Safe areas

For fixed bars at the bottom of the screen (toolbars, tab bars, action buttons), add padding for the iPhone home indicator:

```css
padding-bottom: max(0.5rem, env(safe-area-inset-bottom));
```

## Tooling reference

- `useIsMobile()` from `@/hooks/use-mobile` — boolean, true when viewport < 768 px.
- `<Sheet>` from `@/components/ui/sheet` — slide-in drawer for mobile navigation.
- `<Tabs>` or local pane-state for switching views.

## QA checklist

Before considering a responsive change done, verify in the preview at:

- 375 × 812 (iPhone)
- 768 × 1024 (iPad portrait)
- 1280 × 800 (small desktop)

Look for: cut-off content, horizontal scrollbars on the page (not on explicit tables), unreachable buttons, header overlap with safe areas, and broken pane switching.
