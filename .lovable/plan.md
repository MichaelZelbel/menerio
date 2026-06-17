# Fix: Agent setup prompt — registration + token naming

## Problems

1. The current `agentPrompt` (in `src/components/settings/MCPConnectionManager.tsx`, lines 318–362) reads as a *description*. It never tells the agent to **register / install / persist** the MCP server in its own configuration (e.g. `connections.md`, `.mcp.json`). So Claude Code acknowledges Menerio but doesn't add it to its registry.
2. The prompt says `<PROJECT_MCP_TOKEN>`, but in the Menerio UI it's labeled **Personal MCP Token**. The mismatched name plus two occurrences of the placeholder make it unclear whether the user replaces one or both, and with what.

## Fix

Rewrite the `agentPrompt` `useMemo` (lines 318–362) only. No other code, UI, backend, or per-client snippets.

### 1. Token naming

- Replace every `<PROJECT_MCP_TOKEN>` with `<PERSONAL_MCP_TOKEN>` to match the UI.
- Add one short line under "Connection" explicitly clarifying the placeholder:
  > Replace `<PERSONAL_MCP_TOKEN>` everywhere it appears with the Personal MCP Token shown once when you created it in Menerio → Settings → MCP Server. It's the same token in every header.

### 2. New "Setup (do this first)" section at the top

Imperative, generic, no product names. Tells the agent to:
- Register this MCP server in its own configuration **now**, using whatever mechanism the host environment provides (MCP config file, connections manifest, settings command, or a tool the user gave it).
- Persist the URL and token so they survive across sessions — do not keep them only in conversational memory.
- Name the connection `menerio`.
- If the agent maintains a connections/registry file (such as `connections.md`, `.mcp.json`, or equivalent), add an entry for Menerio there.
- If it can't determine where to register MCP servers in the current environment, ask the user once, then proceed.
- After registering, verify with `initialize` → `tools/list` → `tools/call get_user_profile`, and report the result in one line.

### 3. Reinforcement in "How to behave"

Prepend one bullet:
> Treat the Setup section above as a task to complete on first paste, not background information.

### Sections kept unchanged

- Connection (URL, transport, headers, no path suffixes, 401 handling) — only the placeholder rename and clarifying line.
- What Menerio is.
- Available tools (still defers to `tools/list`).
- Rest of "How to behave".

## Files

- `src/components/settings/MCPConnectionManager.tsx` — rewrite `agentPrompt` `useMemo` (lines 318–362).

## Out of scope

- Protocol card, Available Tools card, tokens UI, MCP server itself.
