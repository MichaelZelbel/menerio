

## Plan: Hide wizard and non-Querino apps from regular users

Two changes, both using the existing `role` from `useAuth()`:

### 1. Hide "Your First Captures" wizard from non-admin users

**File: `src/components/onboarding/FirstCapturesWizard.tsx`**

In the `useShowFirstCaptures` hook, add an early return when `role !== "admin"`. The hook already has access to `useAuth()` — just destructure `role` alongside `user` and skip showing the wizard for non-admins.

### 2. Hide Temerio, Cherishly, Clarinio, Planinio from non-admin users in Settings > Apps

**File: `src/components/settings/AppIntegrations.tsx`**

- Import `useAuth` (already imported) and destructure `role`
- Filter the `KNOWN_APPS` array before rendering: non-admin users only see Querino; admins see all five
- This applies only to the catalog cards — any already-connected custom apps remain visible regardless of role

### Files changed
- `src/components/onboarding/FirstCapturesWizard.tsx` — 2-line change in `useShowFirstCaptures`
- `src/components/settings/AppIntegrations.tsx` — add role check + filter before the `.map()`

