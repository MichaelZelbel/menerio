

## Remove the Profile Tab from Settings

The "Profile" tab currently contains three fields: Display Name, Bio, and Website. Bio and website are not used anywhere in the app. Display Name is used in the sidebar, admin panel, and wizard — but it can be moved into the existing "Account" tab.

### Changes

**1. `src/pages/Settings.tsx`**
- Remove the "Profile" `TabsTrigger` and `TabsContent` entirely (lines 223, 240-277)
- Remove `bio` and `website` state variables (lines 81-82)
- Move the Display Name field into the "Account" tab (above the password section), along with the avatar preview and save handler
- Simplify `handleSaveProfile` to only update `display_name`
- Change `defaultTab` fallback from `"profile"` to `"account"`
- Remove unused `Textarea` import if no longer needed

**2. `src/contexts/AuthContext.tsx`**
- Remove `bio` and `website` from the `Profile` interface and the `fetchProfile` select query

**3. `src/pages/Dashboard.tsx`**
- Line 58: Change `hasProfile` from `profile?.display_name && profile?.bio` to `!!profile?.display_name`

**4. `src/pages/Wizard.tsx`**
- Remove `bio` state variable and bio input field
- Remove `bio` from the `saveProfile` update call
- Keep display name and avatar steps

The `bio` and `website` columns stay in the database (no migration needed) — they just become unused.

