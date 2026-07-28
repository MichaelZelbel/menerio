## Goal
Remove the "open-brain" name (a competitor's product) from the MCP server and rename everything to `menerio-mcp`.

## What currently carries the name
- `supabase/functions/open-brain-mcp/` (folder = deployed function slug, so it's part of the URL `…/functions/v1/open-brain-mcp`)
- `index.ts` — the MCP server identifies itself to clients as `name: "open-brain"` in two places (server info + a health/info response)
- `supabase/config.toml` — `[functions.open-brain-mcp] verify_jwt = false`
- Comments in `_shared/user-profile.ts`, `_shared/mcp-client.ts`, `open-brain-mcp/_ai_visibility.ts`
- Docs: `docs/ARCHITECTURE.md`, `docs/TEST_SCENARIOS.md`

## Plan
1. Move `supabase/functions/open-brain-mcp/` → `supabase/functions/menerio-mcp/` (keeping `index.ts`, `_ai_visibility.ts`, `deno.json` unchanged apart from the renames below).
2. In `index.ts`, change the advertised server name `"open-brain"` → `"menerio"` (both occurrences). This is the string MCP clients display.
3. Update `supabase/config.toml` to `[functions.menerio-mcp] verify_jwt = false`.
4. Update the stale comments in `_shared/user-profile.ts`, `_shared/mcp-client.ts`, `_ai_visibility.ts`.
5. Update the two doc references.
6. Deploy `menerio-mcp`. Keep the old `open-brain-mcp` function deployed for now (no delete) so nothing breaks mid-cutover.

## The one thing that needs your action (URL cutover)
Clients connect to `https://mcp.menerio.com`, which your Cloudflare worker proxies to the Supabase function path `…/functions/v1/open-brain-mcp`. Renaming the function changes that path, so **the worker must be pointed at `/functions/v1/menerio-mcp`** — I can't edit the Cloudflare worker from here.

Sequence to avoid downtime:
1. I deploy `menerio-mcp` (old one still live).
2. You update the worker's target path to `menerio-mcp`.
3. Once confirmed working, I delete the old `open-brain-mcp` function.

No user-facing change otherwise: `mcp.menerio.com`, the `mnr_mcp_` tokens, and all 53 tools stay identical, so connected clients don't need reconfiguring — though some may need a fresh session after the swap.

## Not touched
Token table `mcp_api_tokens`, token prefix, the frontend `MCPConnectionManager` UI (it only references `mcp.menerio.com`), and all tool names/behaviour.
