Goal: Stop showing the duplicate "Out of AI credits" toast, because the dashboard already displays the persistent `LowBalanceBanner` credit warning.

Changes:
1. Edit `src/hooks/useAICreditsGate.ts`:
   - Remove the `useToast` import.
   - Remove the `const { toast } = useToast()` call.
   - Remove the two `toast({ variant: "destructive", ... })` calls inside `checkCredits`.
   - Keep all boolean return logic so AI features are still blocked when credits are exhausted or the plan has zero credits.

Verification:
- Run `bunx tsgo --noEmit` to confirm no TypeScript errors after removing the toast dependency.
- Run `npm run lint` to confirm no new lint issues.

No other files need to change. The `LowBalanceBanner` remains as the single persistent credit warning, and callers of `checkCredits` will still receive `false` and block the action when appropriate.