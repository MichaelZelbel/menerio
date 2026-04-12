

## Auto-Extract People Profile Facts During Note Processing

### What happens today
`process-note` already:
1. Extracts metadata (people, topics, action items) via LLM
2. Matches people names to existing contacts (alias-aware)
3. Creates review queue items for events and unknown contacts

### What we add
After the existing people-matching step, for each **matched** contact, ask the LLM to extract profile-worthy facts from the note. Each fact becomes a review queue item with `suggestion_type: "add_profile_entry"`. When accepted, it inserts into `profile_entries`.

### Changes

**1. `supabase/functions/process-note/index.ts`**

Add a new function `generateProfileSuggestions()` called after `generateReviewItems()`. For each matched person in the note:

- Call the LLM with a prompt like: "Given this note and that it mentions [Person], extract any profile-worthy facts about them. Return JSON array of `{category_slug, label, value}` where category_slug is one of the existing profile categories (identity, location, work, interests, preferences, communication, health, relationships, goals, routines)."
- One LLM call per note (not per person) -- pass all matched people at once
- For each extracted fact, check if a similar entry already exists in `profile_entries` for that contact (by category slug + similar label/value)
- If new, insert into `review_queue` with `suggestion_type: "add_profile_entry"` and payload containing `{contact_id, contact_name, category_slug, label, value}`

**2. `src/pages/ReviewQueue.tsx`**

Add handling for `suggestion_type: "add_profile_entry"`:
- Show it with a person icon and the contact name
- On accept: look up the matching `profile_categories` row for that contact (by slug), insert a `profile_entries` row, and mark accepted
- If the contact doesn't have categories seeded yet, seed them first (same logic as ContactProfileTab)

**3. `src/hooks/useReviewQueue.ts`**

No changes needed -- the existing generic structure handles any suggestion_type.

### Deduplication
- Before inserting suggestions, check existing `profile_entries` for that contact + category + similar label to avoid suggesting what's already known
- Check existing review_queue for duplicate `add_profile_entry` suggestions (same contact + label + value)

### Credit usage
- One additional LLM call per note (only when matched people exist)
- Uses the existing `chatWithCredits` system, so credits are tracked
- Skipped if credits are exhausted

### Flow
```text
Note saved → process-note fires
  → extract metadata (existing)
  → match people to contacts (existing)
  → generate event/contact suggestions (existing)
  → NEW: extract profile facts for matched people
     → check existing profile entries to avoid duplicates
     → insert new suggestions into review_queue
  → user sees "Add to John's profile: Loves climbing" in Review Queue
  → user clicks Accept → profile_entries row created
```

### Files changed
- `supabase/functions/process-note/index.ts` -- add profile fact extraction
- `src/pages/ReviewQueue.tsx` -- add accept handler for `add_profile_entry` type
- `src/components/people/ContactProfileTab.tsx` -- minor: export the default categories list for reuse

