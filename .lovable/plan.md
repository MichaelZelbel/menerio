## Scope

Single file: `src/components/settings/MCPConnectionManager.tsx`. No backend, schema, or routing changes.

## 1. Replace "Compatible Clients" card with a "Protocol" card

Remove the entire `<Card>` (lines ~542–678) that contains the `Accordion` with per-client setup (Claude Desktop, Claude Code, Cursor/VS Code, ChatGPT, Any other MCP client).

Replace it with a new compact "Protocol" card that contains the same content currently under *Any other MCP client*, slightly expanded:

- Title: **Protocol** (icon: `Terminal` or `Plug`)
- Description: "Menerio exposes a standard MCP server. Point any MCP-compatible client at the endpoint below using a Personal MCP Token from this page."
- Body lists:
  - Transport: **MCP Streamable HTTP**
  - Endpoint: `https://mcp.menerio.com` (with copy button, no extra paths)
  - Auth header: `Authorization: Bearer <PROJECT_MCP_TOKEN>` — token must start with `mnr_mcp_`
  - Required headers: `Accept: application/json, text/event-stream` and `Content-Type: application/json`
  - Alternate auth (for clients that can't set headers, e.g. ChatGPT custom connectors): append `?key=<PROJECT_MCP_TOKEN>` to the URL

Also delete the now-unused `claudeSnippet` and `claudeCodeCommand` `useMemo`s and the `Monitor`, `Code2`, `Accordion*` imports if no other usage remains.

Tighten the existing tip on the **Personal MCP Tokens** card (line 332) that hardcodes specific clients ("Claude Desktop, Cursor, OpenClaw, Manus, n8n") to a generic phrasing: "Long-lived, revocable tokens for any MCP-compatible AI client."

## 2. Refresh Agent Setup Prompt

The current `agentPrompt` (lines 263–308) references tools that have been renamed or removed and is missing many that the MCP server now exposes (`search_notes`, `list_recent_notes`, `capture_note`, `update_note`, `trash_note`, People/Moments/Groups/Collections families, graph tools, etc.).

Rewrite the prompt's "Available tools" section to a shorter, *category-based* overview rather than enumerating every tool one by one (so it doesn't go stale every time a tool is added). Keep the Connection, "What Menerio is", and "How to behave" sections largely as-is, but:

- Replace tool-name references in "How to behave" (`search_thoughts` → `search_notes`, `capture_thought` → `capture_note`) and add a bullet directing the agent to call `list_collections` early so it knows about user-defined collections.
- Add: "Call `tools/list` at session start to discover the full, current tool surface — categories below are a guide, not an exhaustive list."

Category sketch:
- **Notes**: `search_notes`, `list_recent_notes`, `capture_note`, `update_note`, `trash_note`, `get_stats`, `get_action_items`
- **People**: `list_people`, `search_contacts`, `get_contact_context`, `get_person_notes`, `log_interaction`
- **Moments (timeline)**: `create_moment_with_ai` (preferred), `list_moments`, `search_moments`
- **Groups**: `list_groups`, `get_group`, `create_group`, `add_group_member`, `update_group_membership`, `log_group_interaction`, `create_group_next_step`, `generate_group_briefing`, plus AI suggestion/import helpers
- **Collections** (user-defined structured data): `list_collections`, `get_collection_schema`, `add_collection_item`, `update_collection_item`, `list_collection_items`, `search_all_collections`
- **Lexicon** (durable synthesized knowledge): `lexicon_search`, `lexicon_get_page`, `lexicon_create_page`, `lexicon_update_page`, `lexicon_run_lint`
- **Knowledge graph**: `get_connected_notes`, `find_path`, `get_clusters`
- **Media**: `search_images`, `get_note_media`
- **Identity**: `get_user_profile`

## 3. Refresh the "Available Tools" card

Rewrite the `TOOLS` constant (lines 62–77) to mirror the categories above so the UI matches reality. Render it grouped by category (heading + list of `{name, desc}` per group) instead of a flat list — minor render change in the existing card. Keep wording short (one line per tool). Add a small footnote: "The authoritative list always comes from `tools/list` on the live MCP server."

## Technical notes

- Pure presentational change; no API, DB, RLS, or edge-function edits.
- Drop unused lucide imports after removing the Compatible Clients card to keep the lint warning-free.
- `bunx tsc --noEmit` should remain clean.
