

## Fix: Semantic search missing conceptually related notes

### Problem
Searching "Italy" returns no results, even though the note "Xihui Rome Visit" exists with a valid embedding. The semantic similarity between "Italy" and a note about "Rome" falls below the default threshold of 0.5, so it gets filtered out by the `match_notes` RPC.

### Root cause
The default `threshold` of 0.5 in both `DashboardSearch.tsx` and `search-notes-semantic/index.ts` is too aggressive for short conceptual queries. Embeddings for a single word like "Italy" vs. a note about "Rome travel plans" may score ~0.3–0.45 similarity — valid semantic matches that get discarded.

### Fix

**1. Lower the default threshold in `DashboardSearch.tsx`**
- Pass `threshold: 0.25` when calling `semanticSearch.mutateAsync()` from the search bar

**2. Lower the default threshold in `search-notes-semantic/index.ts`**
- Change `const threshold = body.threshold ?? 0.5` to `body.threshold ?? 0.25`
- This ensures all callers (search bar, API, etc.) benefit from the improved default

**3. Redeploy the edge function**

### Why 0.25?
- 0.5 is a common starting point but assumes queries closely match document content
- Short, conceptual queries (single words, related concepts) routinely score 0.25–0.45
- Results are still sorted by similarity, so lower-quality matches appear last
- The UI already caps at 8 results, providing a natural quality filter

### Files changed
- `src/components/layout/DashboardSearch.tsx` — pass `threshold: 0.25`
- `supabase/functions/search-notes-semantic/index.ts` — change default threshold from 0.5 to 0.25

### Validation
- Search "Italy" should now return "Xihui Rome Visit"
- Search quality for precise queries remains good (high-similarity results still sort first)

