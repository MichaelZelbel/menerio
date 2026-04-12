

## Fix: People Profile Not Working

### Root Cause
The `profile_categories` table has a unique constraint on `(user_id, slug)`. When a contact profile tries to seed default categories (e.g., "identity", "location"), the insert fails because the user's own profile already has rows with those same slugs under the same `user_id`. The mutation fails silently, so the UI stays stuck on "Initialize Profile".

### Fix

**1. Migration: Update the unique constraint to include `contact_id`**

Drop the existing `(user_id, slug)` constraint and replace it with a unique index on `(user_id, COALESCE(contact_id, '00000000-0000-0000-0000-000000000000'), slug)`. This allows the same slug to exist for the user's own profile (where `contact_id` is null) and for each contact.

**2. `ContactProfileTab.tsx`: Auto-seed without a button**

Remove the "Initialize Profile" fallback button. Instead, after seeding, show a loading state. If seeding has been triggered but categories are still empty (due to query refetch timing), just show the loader. Once categories arrive, render the full profile editor immediately -- same as the user's own profile.

**3. `useContactProfile.ts`: Add error handling to seedDefaults**

Add `onError` to the `seedDefaults` mutation so failures surface as toasts instead of failing silently.

### Files Changed
- 1 new migration (alter unique constraint)
- `src/components/people/ContactProfileTab.tsx` (remove initialize button, auto-seed cleanly)
- `src/hooks/useContactProfile.ts` (add error toast on seed failure)

