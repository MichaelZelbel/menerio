

## Fix: MCP Server Crash — Missing Hono App Instance

### Problem
The `open-brain-mcp` edge function crashes immediately with `ReferenceError: app is not defined`. The file imports Hono but never creates the app instance. Lines 1213 and 1261 reference `app` which doesn't exist.

### Root Cause
During the previous refactor (switching from static key to hub_api_keys auth), the `const app = new Hono();` line was accidentally removed.

### Fix

**File: `supabase/functions/open-brain-mcp/index.ts`**

Add the missing Hono app instantiation after the helper functions and before the `app.all("*")` route handler. Insert around line 1211:

```typescript
const app = new Hono();
```

That single missing line is the entire cause of the crash. Once added, the MCP server will boot correctly and handle requests from ChatGPT.

### Files
- `supabase/functions/open-brain-mcp/index.ts` — add `const app = new Hono();` before the route handler

