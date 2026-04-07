

## Fix: MCP Semantic Search Threshold Too High

### Problem
When searching for "wedding," the MCP server finds nothing because:
1. **Semantic threshold is 0.5** — too strict for conceptually related terms like "wedding" vs "marriage papers" (similarity likely ~0.3-0.45)
2. **ILIKE fallback** only matches exact substrings, so "wedding" won't match text containing "marriage"

The in-app semantic search already uses a threshold of **0.25** and works well. The MCP server should match this.

### Fix

**File: `supabase/functions/open-brain-mcp/index.ts`**

1. Change the default threshold from `0.5` to `0.25` (line 145)
2. This matches the tuned threshold already used in the app's `search-notes-semantic` function

One-line change:
```
threshold: z.number().optional().default(0.25)
```

### Why this works
- "Wedding" and "marriage" have high semantic similarity (~0.3-0.4) — above 0.25 but below 0.5
- The in-app search uses 0.25 and successfully finds conceptually related notes
- Lower threshold may return slightly more results, but the semantic ranking ensures the best matches appear first

### Files to change
- `supabase/functions/open-brain-mcp/index.ts` — lower default threshold from 0.5 to 0.25

