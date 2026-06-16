# Fix: clicking a note shows the list, not the editor (narrow preview widths)

## What's actually happening

In the Notes page the two panels are sized by **two different mechanisms** that can disagree:

- **Tailwind CSS** — the list panel uses `w-full md:w-72`. Below 768 px the list is full width; at/above 768 px it's a 288 px column.
- **JavaScript** — `useIsMobile()` decides whether the list pane gets `hidden` (when a note is selected) and whether the editor pane gets `hidden` (when no note is selected).

`useIsMobile()` returns `false` on the very first render (its state starts as `undefined` → `!!undefined` → `false`) and only flips to the correct value inside a `useEffect`. So on the first paint at a viewport like ~700 px:

- Tailwind: `md:w-72` does **not** apply → list is `w-full`.
- JS: thinks "desktop" → does not add `hidden` to the list.
- Result: the list panel takes the entire container width. The editor sits next to it with `flex-1`, but its sibling is `w-full shrink-0`, so the editor gets 0 px of width and is invisible. That's exactly what your screenshot shows after clicking "Hello World".

Even after the effect fires, any later re-mount or width change can reproduce the same one-frame disagreement, and at the exact boundary (≈767–768 px) the two systems can stay out of sync because they key off subtly different media queries (`max-width: 767px` vs `min-width: 768px`) and the JS initial value.

## Fix

Make `useIsMobile()` the **single source of truth** for the Notes layout and remove the Tailwind responsive width classes from the panels.

### 1. `src/hooks/use-mobile.tsx`

Resolve the initial value synchronously so the first render is already correct:

```ts
const [isMobile, setIsMobile] = React.useState<boolean>(() =>
  typeof window !== "undefined" &&
  window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`).matches
);
```

Keep the existing `matchMedia` listener for live resizes. Return `isMobile` directly (no `!!`).

### 2. `src/pages/Notes.tsx` — list panel (around line 745)

Replace:

```tsx
"w-full md:w-72",
isMobile && selectedId ? "hidden" : "flex"
```

with width driven by `isMobile`:

```tsx
isMobile ? "w-full" : "w-72",
isMobile && selectedId ? "hidden" : "flex"
```

### 3. `src/pages/Notes.tsx` — editor panel (around line 1186)

No class changes needed. With the list panel either `hidden` (mobile, note selected) or a fixed `w-72` column (desktop), the `flex-1 min-w-0` editor always has room to render.

### 4. Verify

- View the preview at 600 px, 767 px, 768 px, and 1200 px widths.
- At all narrow widths: clicking a note should hide the list and show the editor full-width with a "← Notes" back button.
- At ≥ 768 px: both panels visible side by side; clicking a note swaps the editor content in place with no flash and no disappearing panel.

## Technical notes

- The bug is **not** the route change we made earlier — that fix (single `notes/*` route) is still correct and stays.
- The breakpoint stays at 768 px to match Tailwind's `md` for the rest of the app; only the Notes panel widths stop relying on the `md:` class.
- No data, query, or editor changes. Scope is layout + the mobile hook's initial value.
