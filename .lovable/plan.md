

# Fix "Failed to initialize contact profile" in Review Queue

## Root cause
When you click **Accept** on a `add_profile_entry` suggestion in the Review Queue, the code calls:

```ts
supabase
  .from("profile_categories")
  .upsert(rows, { onConflict: "user_id,contact_id,slug", ignoreDuplicates: true })
```

…and Postgres replies:

> there is no unique or exclusion constraint matching the ON CONFLICT specification

That's because the actual unique index on `profile_categories` is **expression-based**:

```
UNIQUE (user_id, COALESCE(contact_id, '00000000-...'), slug)
```

Postgres only matches `ON CONFLICT (cols)` against constraints / indexes whose columns match **exactly**. An index over `COALESCE(contact_id, …)` is not the same as `contact_id`, so the upsert can never bind to it and always fails.

The same broken `onConflict` string is used twice in `handleAcceptProfileEntry`:
- when seeding the 17 default categories
- when creating a missing custom category

## Fix

Replace both `upsert(..., { onConflict: "user_id,contact_id,slug" })` calls in `src/pages/ReviewQueue.tsx` with **plain inserts plus a follow-up select**, mirroring the pattern already used successfully in `src/hooks/useContactProfile.ts`:

1. **Seeding defaults**
   - Do a plain `insert(rows)` of the default categories.
   - If it errors with a unique-violation (`23505` / message contains `profile_categories_user_contact_slug_idx`), treat it as already-seeded and continue.
   - Re-fetch categories for `(user_id, contact_id)` and pick the one whose `slug` matches the suggestion.

2. **Creating a single missing category**
   - First `select` for `(user_id, contact_id, slug)` — if found, use it.
   - Otherwise plain `insert` the row and read the new `id`.
   - On a unique-violation race, re-`select` and use the existing row.

3. Keep the rest of the handler unchanged: insert the `profile_entries` row, invalidate the contact-profile React Query keys, mark the review item accepted, show the success toast.

No database migration required — the existing partial-unique index already protects against duplicates correctly. We're just adapting the client to not rely on `ON CONFLICT` against an expression index.

## Files to change

| File | Change |
|---|---|
| `src/pages/ReviewQueue.tsx` | Replace the two `upsert(..., { onConflict: "user_id,contact_id,slug" })` calls in `handleAcceptProfileEntry` with insert + re-select logic, and treat unique-violation errors as "already exists" |

## Verification
- Click **Accept** on a Florian-Knöll profile-entry suggestion → entry is added, toast appears, no error.
- Click **Accept** on a profile-entry suggestion for a contact whose profile categories are already seeded → still works (re-select finds the right category).
- Click **Skip** / **Never** on any item → still works (these don't touch `profile_categories`).
- Click **Accept** on `add_relationship`, `add_alias`, `add_contact`, event suggestions → unaffected.

