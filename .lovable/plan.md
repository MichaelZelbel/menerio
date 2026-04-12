

## Fix: AI Suggests Adding People Who Already Exist (Spelling Variations)

### Root Cause
The contact matching in `process-note` uses **exact string match** only. The AI extracted "Gaujie" from the note title, but the actual contact is stored as "Gaojie". Since `"gaujie" !== "gaojie"`, the system treats it as a new person and suggests adding them.

This will happen for any spelling variation, typo, or transliteration difference (common with non-English names).

### Fix: Add Fuzzy Name Matching

**File: `supabase/functions/process-note/index.ts`**

1. Add a lightweight fuzzy matching function (Levenshtein distance or similar) directly in the file -- no new dependencies needed. A simple implementation is ~15 lines.

2. When a person name doesn't match exactly, check all existing contact names/aliases for close matches (e.g., edit distance <= 2, or normalized distance < 0.3 for short names).

3. If a close match is found:
   - Treat it as a match to the existing contact (same as exact match)
   - Add the extracted spelling as a suggested alias via a new review queue item (`suggestion_type: "add_alias"`) so the user can confirm

4. If no close match is found either, proceed with the current "add_contact" suggestion as before.

**File: `src/pages/ReviewQueue.tsx`**

5. Add a handler for the new `"add_alias"` suggestion type. On accept, append the alias to the contact's `aliases` array.

### Matching Logic (pseudocode)
```text
for each extracted person name:
  1. exact match against contacts + aliases → matched
  2. fuzzy match (edit distance ≤ 2) → matched + suggest alias
  3. no match → suggest add_contact
```

### Additional Hardening

6. **Validate extracted names against source text**: Before suggesting "add_contact", verify the extracted name actually appears in the note content. If the LLM hallucinated a name that isn't in the text at all, skip it entirely. This catches pure hallucinations.

### Scope
- `supabase/functions/process-note/index.ts` -- add fuzzy matching + source text validation
- `src/pages/ReviewQueue.tsx` -- add "add_alias" accept handler
- Deploy updated edge function

### Immediate Fix for Current Item
- Dismiss the current "Gaujie" suggestion and add "Gaujie" as an alias to the existing "Gaojie" contact (can be done manually or we can clean it up in the migration)

