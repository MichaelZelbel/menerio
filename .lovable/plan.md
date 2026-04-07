

## Auto-Generate MCP Access Key Using Hub API Keys

### Problem
The MCP settings page asks users to "paste the value you set as MCP_ACCESS_KEY in your Supabase project secrets" — but regular users have no access to Supabase and don't know what that means. The MCP server also uses a single static env var (`MCP_ACCESS_KEY`) shared across all users, tied to a hardcoded `BRAIN_OWNER_USER_ID`.

### Solution — Use the existing Hub API Keys system

The project already has a per-user API key system (`hub_api_keys` table + `hub-api-keys` edge function + `hub-auth.ts` shared helper). We should:

1. **Let users generate an MCP key with one click** from the MCP settings page
2. **Update the MCP server** to authenticate via `hub_api_keys` (hash lookup) instead of the static env var, resolving the `user_id` from the key

### Changes

**1. `src/components/settings/MCPConnectionManager.tsx`**
- Remove the manual "paste your access key" input
- Add a "Generate MCP Key" button that calls `hub-api-keys/generate` with `name: "MCP Connection"` and `scopes: ["profile", "notes", "contacts", "actions", "graph", "media", "stats"]` (all scopes)
- Show the generated key once, store it in localStorage for snippet population
- If a key already exists in localStorage, show it masked with a "Regenerate" option
- Also fetch existing hub API keys and check if one named "MCP Connection" exists — if so, show its prefix and status
- All config snippets use the generated `mnr_...` key directly

**2. `supabase/functions/open-brain-mcp/index.ts`**
- Replace the static `MCP_ACCESS_KEY` / `BRAIN_OWNER_USER_ID` auth with the shared `hub-auth.ts` helper
- In the `app.all("*")` handler: extract the key from `x-brain-key` header or `?key=` query param, hash it with SHA-256, look up in `hub_api_keys`, get the `user_id` from the key row
- Pass the resolved `user_id` to all tool handlers instead of the hardcoded `BRAIN_OWNER_USER_ID`
- Keep backward compatibility: if the old `MCP_ACCESS_KEY` env var is set and matches, fall back to `BRAIN_OWNER_USER_ID` (so existing setups don't break immediately)

**3. UX flow**
- User visits MCP settings → clicks "Generate Key" → sees the `mnr_...` key once → copies it or copies the pre-populated config snippets → done
- No mention of Supabase, env vars, or secrets anywhere in the UI

### Files
- `src/components/settings/MCPConnectionManager.tsx` — one-click key generation, remove manual input
- `supabase/functions/open-brain-mcp/index.ts` — authenticate via hub_api_keys, resolve user_id per request

