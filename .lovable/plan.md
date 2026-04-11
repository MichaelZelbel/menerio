

## Wire Up Querino & Temerio in GlobalCreateButton

### What's changing
Update `GlobalCreateButton` to query `connected_apps` for active querino/temerio connections, conditionally show the menu items, and wire real actions.

### Changes

**File: `src/components/layout/GlobalCreateButton.tsx`**
- Add a `useQuery` call to fetch active connected apps: `select("app_name, webhook_url").eq("user_id", user.id).eq("is_active", true)`
- Derive `querinoApp` and `temerioApp` from the results
- **Querino item**: Only shown when connected. On click, opens a new tab to `{querinoApp.webhook_url}/create-from-menerio?title=&body=&entity_type=prompt&menerio_callback={SUPABASE_URL}/functions/v1/link-note`. No `menerio_note_id` since this is a blank prompt (not from a specific note).
- **Temerio item**: Only shown when connected. On click, opens the `CreateEventDialog` with an empty draft.
- The separator before integration items only renders when at least one integration is connected.
- Remove the hardcoded disabled placeholders.

**File: `src/components/layout/GlobalCreateButton.tsx`** (imports)
- Add: `useQuery` from tanstack, `supabase` client, `useAuth`, `useState` for dialog state, `CreateEventDialog`

### Querino URL construction
```text
https://{querino_webhook_url}/create-from-menerio
  ?title=
  &body=
  &entity_type=prompt
  &menerio_callback=https://tjeapelvjlmbxafsmjef.supabase.co/functions/v1/link-note
```
The `webhook_url` stored in `connected_apps` for querino points to the Querino base URL. We append `/create-from-menerio` and the callback parameter.

### Temerio flow
Opens `CreateEventDialog` with `draft = null` (empty form). The dialog already handles the full submission to Temerio via the `send-to-temerio` edge function.

### Scope
One file changed: `GlobalCreateButton.tsx`. No backend changes needed -- `link-note` edge function already handles the callback from Querino.

