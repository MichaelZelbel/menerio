

## Fix: Case-Sensitive Search Behavior — "Adobe" vs "adobe"

### Root Cause

The note "Gamsgo" (containing "Adobe") has **no embedding vector**. This means semantic search can never find it. The only way to find it is via ILIKE text search.

The bug is in **how results are combined**:

**DashboardSearch (in-app):** Line 59 does `semanticResults.length > 0 ? semanticResults : ilikeResults` — when semantic returns ANY results (even unrelated), it completely discards the ILIKE results. With "adobe", the embedding happens to return no results above threshold, so ILIKE results show through. With "Adobe", the slightly different embedding returns some unrelated results, which then replace the correct ILIKE match.

**search-notes-semantic (edge function):** The ILIKE fallback on lines 181-190 only runs when the embedding API call *fails entirely*. When it succeeds but the target note has no embedding, that note is simply invisible.

### Fix — Two changes

**1. `src/components/layout/DashboardSearch.tsx`**

Merge ILIKE and semantic results instead of replacing one with the other. Deduplicate by note ID, with semantic results taking priority for ordering:

```typescript
// Instead of: semanticResults.length > 0 ? semanticResults : ilikeResults
// Merge: start with semantic, append ILIKE results not already present
const mergedResults = useMemo(() => {
  if (semanticResults.length === 0) return ilikeResults;
  const seenIds = new Set(semanticResults.map(r => r.id));
  const extra = ilikeResults.filter(r => !seenIds.has(r.id));
  return [...semanticResults, ...extra].slice(0, 8);
}, [semanticResults, ilikeResults]);
```

**2. `supabase/functions/search-notes-semantic/index.ts`**

After the successful semantic search (line 84-180), also run the ILIKE query and merge results — same pattern already used in the MCP `search_thoughts` tool. Add text results for notes that semantic search missed (no embedding):

```typescript
// After semantic results are built, also run ILIKE and merge
const textResults = await ilikeFallback(user.id, query, limit);
for (const t of textResults) {
  if (!noteMap.has(t.id)) {
    noteMap.set(t.id, t);
  }
}
```

### Files to change
- `src/components/layout/DashboardSearch.tsx` — merge ILIKE + semantic instead of replacing
- `supabase/functions/search-notes-semantic/index.ts` — always run ILIKE alongside semantic, merge results

