

## Fix: Show Note Titles Earlier and Support Dark/Light Themes

### Problem
1. Labels only appear when zoomed in past `globalScale > 2.5` (very zoomed in), or on hover/select. The default `labelMode` is `"hover"`.
2. Label text color is hardcoded to `hsl(220, 25%, 20%)` (dark text) -- invisible on dark backgrounds.

### Changes

**File: `src/pages/KnowledgeGraph.tsx`**

1. **Lower the zoom threshold for labels**: Change `globalScale > 2.5` to `globalScale > 1.2` so labels appear much earlier when zooming in slightly.

2. **Change default `labelMode`** from `"hover"` to `"always"` so labels are visible by default without requiring any zoom.

3. **Theme-aware label colors**: Detect the current theme (check for `dark` class on `document.documentElement`) and set label fill color accordingly:
   - Light mode: `hsl(220, 25%, 20%)` (dark text, current)
   - Dark mode: `hsl(220, 15%, 85%)` (light text)
   - Dimmed variants adjusted for both themes too

4. **Add a text background/halo** behind labels for readability: Draw a subtle filled rect or use `ctx.strokeText` with a contrasting stroke to ensure labels are readable regardless of what nodes/edges are behind them.

### Scope
- Single file change: `src/pages/KnowledgeGraph.tsx`
- Lines ~101, ~226-238 (label logic in `nodeCanvasObject`)

