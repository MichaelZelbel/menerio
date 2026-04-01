

## Add LLM Usage Log Table to Admin AI Credits Tab

### What changes

Add a new `UsageLogTable` component below the existing `CreditsSettingsTab` card in the "AI Credits" tab. This table displays all `llm_usage_events` entries across all users with filtering, pagination, and usage-source indication.

### Data source

Query `llm_usage_events` joined with `profiles` (for display names). The RLS on `llm_usage_events` only allows SELECT for own user — but admin users need to see all. This requires a new RLS policy.

### Database migration

Add an admin SELECT policy on `llm_usage_events`:
```sql
CREATE POLICY "Admins can view all usage events"
ON public.llm_usage_events
FOR SELECT
TO authenticated
USING (is_admin(auth.uid()));
```

### UI structure (single file: `src/pages/Admin.tsx`)

1. **Modify `CreditsSettingsTab`** to render the existing settings card plus a new `<UsageLogTable />` underneath.

2. **New `UsageLogTable` component** with:
   - Card titled "LLM Usage Log"
   - Filters row: user search input (by display name) + model select dropdown (populated from distinct models in data)
   - Table columns: Time, User, Feature, Model, Prompt Tokens, Completion Tokens, Total Tokens, Source (provider/fallback badge)
   - Pagination: Previous/Next buttons, 20 rows per page
   - The "Source" column checks `metadata->usage_source`; if missing, shows "unknown"

3. **Data fetching**: 
   - Fetch from `llm_usage_events` with `.order("created_at", { ascending: false })` and `.range()` for pagination
   - Join user names by fetching `profiles` for the user IDs on the current page
   - Filter by model using `.eq("model", selectedModel)` when set
   - Filter by user by first looking up matching profile IDs, then filtering with `.in("user_id", matchedIds)`

### Files changed
- `src/pages/Admin.tsx` — add `UsageLogTable` component, update `CreditsSettingsTab` to include it
- New migration — add admin RLS policy on `llm_usage_events`

