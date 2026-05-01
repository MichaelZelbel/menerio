## Reorganize Dashboard Sidebar Menu

Restructure the main navigation in `src/components/layout/DashboardSidebar.tsx` into four logical groups, separated by visual dividers, and remove the "Main" group label.

### New Structure

**Group 1 — Overview (no label)**
- Dashboard

**Group 2 — Knowledge (no label)**
- Notes
- Note Graph
- Lexicon

**Group 3 — Relations (no label)**
- People
- Groups
- Timeline

**Group 4 — Library (no label)**
- Collections
- Media Library

**Group 5 — Review (no label)**
- Review (Review Queue, with pending count badge)
- Weekly Review

The existing **System** group (My Profile, Settings, Connect AI, Documentation, Admin) and footer (Credits, Sign Out) remain unchanged.

### Implementation Details

- Replace the single `mainItems` array with five small arrays (or one array of arrays) rendered as separate `SidebarGroup` blocks.
- Omit `<SidebarGroupLabel>` for these new groups so no headings appear above them.
- Insert a `<SidebarSeparator />` between each of the five groups to keep the visual grouping clear in both expanded and collapsed (icon-only) states.
- Keep the existing `SidebarSeparator` before the System group.
- Preserve all current behavior: active route highlighting via `isActive`, the pending-count `Badge` on the Review item, tooltips, and `NavLink` `end` prop on `/dashboard`.
- The unused `premiumItems` block (currently empty) can be removed for clarity.

No routes, hooks, or other files need to change.
