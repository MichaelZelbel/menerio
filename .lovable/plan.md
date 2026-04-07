

## Fix: MCP Search Can't Find Notes Without Embeddings

### Root Cause
The note containing "Adobe" (id: `33792dc0-...`) has **no embedding vector**. The MCP `search_thoughts` tool uses only semantic search (`match_notes` RPC), which skips notes without embeddings entirely. There is no text-based fallback.

### Two problems to fix

**1. Add a text fallback to `search_thoughts`**

In `supabase/functions/open-brain-mcp/index.ts`, after the semantic search returns results, also run an ILIKE text search and merge results. This ensures notes without embeddings (or notes where the exact word matters more than meaning) are still found.

Logic:
- Run semantic search as before
- Also run ILIKE search: `title.ilike.%query%,content.ilike.%query%`
- Merge results, deduplicating by note ID (semantic results take priority for ordering)
- Return combined results

**2. Backfill the missing embedding for this note**

The note should have had an embedding generated when it was created/updated. This is a data issue — either the `process-note` function wasn't triggered, or it failed silently. We can trigger a re-process, but the text fallback is the real fix since embeddings can always be missing for various reasons.

### Implementation

**File: `supabase/functions/open-brain-mcp/index.ts`**

Modify the `search_thoughts` tool handler (~lines 148-177):
- After semantic search completes, run an additional ILIKE query for `title` and `content` matching the raw query string
- Merge ILIKE results into the semantic results, skipping duplicates
- If semantic search fails entirely (e.g., embedding API error), fall back to ILIKE-only results instead of returning an error

This mirrors what `note-chat`'s `search_notes_semantic` tool already does (it has an ILIKE fallback on line ~183 of note-chat).

### Files to change
- `supabase/functions/open-brain-mcp/index.ts` — add ILIKE fallback to `search_thoughts` tool

