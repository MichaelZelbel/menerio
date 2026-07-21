## Plan: stop disturbing users with AI credit warning toasts

1. **Remove the remaining credit-warning toast at the source**
   - Edit `src/hooks/useAICredits.ts`.
   - Remove the `useToast` import, `toast` setup, `warnedRef`, and the low-credit warning block that currently creates the red toast: `AI credits running low`.

2. **Keep credit data and blocking behavior intact**
   - Keep `useAICredits()` fetching and returning credit balances for dashboard/settings displays.
   - Keep `useAICreditsGate()` blocking AI actions when credits are exhausted.
   - Do not add any replacement toast, banner, snackbar, popup, or bottom notification for low/exhausted credits.

3. **Clean up dependencies**
   - Update the `fetchCredits` callback dependency list so it no longer depends on `toast`.

4. **Verify**
   - Search the codebase again for AI-credit toast strings to confirm there are no remaining user-facing credit warning toasts.
   - Run the existing type/lint check used for this project.

## Expected result

AI credit warnings will no longer appear as toasts anywhere from the credit hook. Existing non-intrusive credit displays can still show balances where the UI explicitly renders them.