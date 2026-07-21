Goal: Stop showing the red "AI credits running low" / "Out of AI credits" banner at the top of the dashboard. Credit status remains visible in Settings → Credits and via the existing `CreditsDisplay`, but nothing intrusive appears during normal use.

Changes:
1. `src/components/layout/DashboardLayout.tsx`
   - Remove the `import { LowBalanceBanner }` line.
   - Remove the `<LowBalanceBanner />` render inside the layout.
2. `src/components/layout/LowBalanceBanner.tsx`
   - Delete the file (no other consumers — verified with a codebase search).

Behavior preserved:
- `useAICreditsGate` still blocks AI actions when credits are exhausted (silently, no toast).
- Users can still see and manage credits under `/dashboard/settings?tab=credits` and via `CreditsDisplay` in Settings.

Verification:
- `bunx tsgo --noEmit` — confirm no dangling imports.
- `npm run lint` — confirm clean.
