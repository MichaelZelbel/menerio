

# People Relationships Feature

## Summary
Add a structured relationships system to Menerio that connects people to each other (and to the logged-in user), with perspective-aware labels and LLM-powered suggestions via the Review Queue.

## Data Model

A new `contact_relationships` table stores directional relationship edges:

```text
contact_relationships
─────────────────────
id              uuid PK
user_id         uuid NOT NULL (owner, for RLS)
source_type     text NOT NULL ('contact' | 'self')
source_id       uuid NULL (contact_id, NULL when source_type='self')
target_type     text NOT NULL ('contact' | 'self')
target_id       uuid NULL (contact_id, NULL when target_type='self')
label           text NOT NULL (e.g. 'employee', 'brother')
custom_label    text NULL (manual override)
inverse_id      uuid NULL (FK → contact_relationships.id, links paired records)
created_at      timestamptz
updated_at      timestamptz
```

- `source_type='self'` + `source_id=NULL` means "me (the logged-in user)".
- `inverse_id` links paired records: when you add "Max is my employee", the system suggests the mirror "Michael is Max's employer" in the Review Queue.
- RLS: `user_id = auth.uid()` on all operations.

### Label Pairs (predefined)

A hardcoded list of label pairs provides perspective-aware display:

```text
employee ↔ employer
friend ↔ friend
brother ↔ brother/sister (gendered pairs)
sister ↔ brother/sister
mother ↔ son/daughter
father ↔ son/daughter
son ↔ mother/father
daughter ↔ mother/father
partner ↔ partner
spouse ↔ spouse
mentor ↔ mentee
manager ↔ report
co-worker ↔ co-worker
neighbor ↔ neighbor
roommate ↔ roommate
```

When viewing Max's profile and the relationship says `label='employee', source_type='self'`, the UI shows: **"Employee of Michael"**. On Michael's own profile, it shows **"Max is my employee"**.

Custom labels bypass the pair system — the user types both the forward and inverse label manually.

## UI Design

### Inside the Profile Tab
A new "Relationships" section renders at the top of the Profile tab (above categories), since relationships are structurally different from key-value entries:

- Each relationship shows: the other person's name (clickable link to their People page), the label (from the current profile's perspective), and optionally a custom override.
- An "Add relationship" button opens a small form: pick a contact (or "Me"), pick a label from the standard list or type a custom one.
- Each relationship has edit/delete actions.

### Perspective Display Logic
When viewing **Max's profile**, a relationship where `source_type='self', label='employee'` displays as:
> **Michael** — employer

When viewing **Michael's own profile** (or "My Profile"), the same relationship from source shows:
> **Max** — employee

The UI always answers: "Who is this person to the profile I'm looking at?"

## LLM Integration

### Extraction
Extend the `generateProfileSuggestions` function in `process-note/index.ts` to also extract relationships. The prompt will ask for an additional `relationships` array alongside profile facts:

```json
{
  "facts": [...],
  "relationships": [
    { "person_a": "Max", "person_b": "Michael", "label_a_to_b": "employer", "label_b_to_a": "employee" }
  ]
}
```

### Review Queue
A new suggestion type `add_relationship` appears in the Review Queue. Accepting it:
1. Creates the forward relationship record.
2. Creates a second Review Queue item for the inverse (the "suggested mirror" approach you chose).

Deduplication checks existing `contact_relationships` rows before inserting.

## Implementation Steps

1. **Database migration**: Create `contact_relationships` table with RLS policies.
2. **Shared constants**: Create `src/lib/relationship-labels.ts` with the label pairs and helper functions for perspective display.
3. **Hook**: Create `src/hooks/useContactRelationships.ts` — CRUD operations for relationships scoped to a contact or self.
4. **UI component**: Create `src/components/people/RelationshipsSection.tsx` — renders inside the Profile tab, handles add/edit/delete.
5. **ContactProfileTab update**: Mount the RelationshipsSection above the category sections.
6. **Process-note update**: Extend the profile extraction prompt and parser to extract relationships, insert `add_relationship` items into `review_queue`.
7. **ReviewQueue update**: Handle `add_relationship` acceptance — insert the record and create the inverse suggestion.
8. **My Profile**: Add RelationshipsSection to the user's own Profile page so self-relationships are visible there too.

## Files to Create/Modify

| File | Action |
|------|--------|
| `supabase/migrations/NNNN_create_contact_relationships.sql` | New — table + RLS |
| `src/lib/relationship-labels.ts` | New — label pairs, inverse lookup, display helpers |
| `src/hooks/useContactRelationships.ts` | New — query/mutate relationships |
| `src/components/people/RelationshipsSection.tsx` | New — UI component |
| `src/components/people/ContactProfileTab.tsx` | Modify — mount RelationshipsSection |
| `src/pages/Profile.tsx` | Modify — mount RelationshipsSection for self |
| `supabase/functions/process-note/index.ts` | Modify — extend prompt + parser |
| `src/pages/ReviewQueue.tsx` | Modify — handle `add_relationship` type |

