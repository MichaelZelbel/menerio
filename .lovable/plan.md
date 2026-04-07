

## Deduplicate Review Queue Suggestions

### Problem
Every time a note is processed (saved/updated), `process-note` generates new review queue entries without checking if identical suggestions already exist. This produces duplicates like the five "Add Nate Jones" entries visible in the screenshot.

### Solution — Two-part fix

**1. Prevent future duplicates (edge function change)**

**File: `supabase/functions/process-note/index.ts`**

Before inserting suggestions, query existing pending/accepted entries for the same `(user_id, suggestion_type, source_note_id, title)` combination and filter them out:

```typescript
// After building suggestions[], before insert:
const { data: existing } = await supabase
  .from("review_queue")
  .select("suggestion_type, source_note_id, title")
  .eq("user_id", userId)
  .in("status", ["pending", "accepted"]);

const existingSet = new Set(
  (existing || []).map((e: any) => `${e.suggestion_type}|${e.source_note_id}|${e.title}`)
);

const newSuggestions = suggestions.filter(
  s => !existingSet.has(`${s.suggestion_type}|${s.source_note_id}|${s.title}`)
);
```

For `add_contact` suggestions specifically, also deduplicate across notes — if there's already a pending "Add Nate Jones" from any note, don't create another one. This uses `suggestion_type + payload.name` as the dedup key.

**2. Clean up existing duplicates (migration)**

Add a migration that removes duplicate pending rows, keeping only the oldest entry per `(user_id, suggestion_type, title)` group:

```sql
DELETE FROM public.review_queue
WHERE id NOT IN (
  SELECT DISTINCT ON (user_id, suggestion_type, title)
         id
  FROM public.review_queue
  WHERE status = 'pending'
  ORDER BY user_id, suggestion_type, title, created_at ASC
)
AND status = 'pending'
AND id IN (
  SELECT id FROM public.review_queue
  WHERE (user_id, suggestion_type, title) IN (
    SELECT user_id, suggestion_type, title
    FROM public.review_queue
    WHERE status = 'pending'
    GROUP BY user_id, suggestion_type, title
    HAVING count(*) > 1
  )
);
```

**3. Add unique constraint (migration)**

Add a partial unique index to prevent duplicates at the database level as a safety net:

```sql
CREATE UNIQUE INDEX uq_review_queue_pending
  ON public.review_queue (user_id, suggestion_type, title)
  WHERE status = 'pending';
```

### Files to change
- `supabase/functions/process-note/index.ts` — dedup check before insert
- New migration — clean existing duplicates + add unique index

