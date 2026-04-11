

## Add Global "New" Split Button to Dashboard Header

### What's changing
Move the "New Note" button from the Dashboard page into the dashboard header bar (next to the search box), making it visible on every page. Convert it into a **split button**: clicking the main area creates a new note instantly, while a small dropdown chevron reveals additional creation options.

### UX Pattern: Split Button
```text
┌──────────────┬───┐
│  + New Note  │ ▾ │   ← main click = new note
└──────────────┴───┘
                 │
                 ▼
          ┌─────────────────────┐
          │ 📝 New Note         │
          │ 👤 New Person       │
          │ ─────────────────── │
          │ 🔮 New Prompt       │  ← if Querino connected
          │ 📅 New Event        │  ← future, if Temerio connected
          └─────────────────────┘
```

The main button click always creates a new note (the most common action). The chevron opens a dropdown with all creation options. This is a well-established pattern (GitHub, Google Drive, Figma, etc.) -- very intuitive.

### Changes

| File | Change |
|------|--------|
| **`src/components/layout/GlobalCreateButton.tsx`** | New component: split button with `DropdownMenu`. Primary click navigates to `/dashboard/notes?action=create`. Dropdown items: New Note, New Person (navigates to `/dashboard/people` with a create action), New Prompt (conditionally shown), New Event (conditionally shown, disabled/coming soon). |
| **`src/components/layout/DashboardLayout.tsx`** | Add `<GlobalCreateButton />` in the header bar, between `<DashboardSearch />` and the right-side icons. |
| **`src/pages/Dashboard.tsx`** | Remove the "New Note" button from the welcome section (line 82-84), since it now lives in the header globally. |

### Behavior
- **New Note**: navigates to `/dashboard/notes?action=create` (existing mechanism)
- **New Person**: navigates to `/dashboard/people?action=create` (will need a small handler in People page, similar to Notes)
- **New Prompt / New Event**: shown conditionally based on integration status; New Event shows as "Coming soon" for now
- Keyboard shortcut: could reuse or add `Cmd+N` for new note

### Technical details
- Uses existing `DropdownMenu` component from `@/components/ui/dropdown-menu`
- The split button is two elements side by side: a `Button` for the primary action and a `DropdownMenuTrigger` styled as a connected chevron button
- Responsive: on mobile, shows just the `+` icon without text

