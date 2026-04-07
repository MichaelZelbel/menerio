

## Fix: Invalidate contacts cache after accepting "Add Contact" suggestion

### Problem
When a user accepts an "add_contact" suggestion in the Review Queue, the contact is inserted directly into the `contacts` table but the React Query cache for the People page (`["contacts", user?.id]`) is never invalidated. So navigating to People shows stale (empty or outdated) data until a full page reload.

### Fix

**File: `src/pages/ReviewQueue.tsx` (~line 60-67)**

After the successful contact insert, call `queryClient.invalidateQueries({ queryKey: ["contacts"] })` to bust the cache. This requires:
1. Adding `useQueryClient` import from `@tanstack/react-query`
2. Calling `const queryClient = useQueryClient()` in the component
3. Adding `queryClient.invalidateQueries({ queryKey: ["contacts"] })` after the insert succeeds (line ~65, before or after the `updateStatus.mutate` call)

Single file, 3-line addition.

