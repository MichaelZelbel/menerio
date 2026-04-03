

# Review Queue for AI Suggestions

## Overview

Add a "Review Queue" — a persistent inbox where Menerio's AI places actionable suggestions after processing notes. Users see a badge count in the sidebar and can accept, dismiss, or act on each suggestion from a dedicated page.

## What triggers suggestions

The `process-note` edge function already extracts metadata (people, dates, topics, type). We extend it to also generate **cross-app suggestions** by analyzing the extracted metadata against connected apps and known patterns:

- **Event detected** (dates + people) → suggest "Add to Temerio" and/or "Add to Cherishly"
- **Person mentioned** not yet in contacts → suggest "Add to People"
- **Action item extracted** → already goes to action_items, but could also suggest linking to a project in Planinio

## Architecture

```text
process-note (edge fn)
  └─ after metadata extraction, calls generateSuggestions()
     └─ inserts rows into `review_queue` table
        └─ client polls / subscribes via React Query

Sidebar: "Review" link with unread count badge
/dashboard/review-queue page: list of suggestion cards with Accept/Dismiss
```

## Database: new `review_queue` table

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| user_id | uuid | RLS owner |
| source_note_id | uuid | The note that triggered it |
| suggestion_type | text | `add_event_temerio`, `add_event_cherishly`, `add_contact`, `link_note` |
| title | text | Human-readable suggestion title |
| description | text | Why the AI suggests this |
| payload | jsonb | Pre-filled data (event draft, contact info, etc.) |
| status | text | `pending`, `accepted`, `dismissed` |
| created_at | timestamptz | |
| reviewed_at | timestamptz | nullable |

RLS: users can manage own rows.

## Changes

### 1. Migration: create `review_queue` table

Standard table with RLS policy for authenticated users on own rows.

### 2. Edge function: `process-note/index.ts`

After metadata extraction (line ~119), add a `generateReviewItems()` call that:
- Checks if dates + people are detected → creates `add_event_temerio` / `add_event_cherishly` suggestions with pre-filled EventDraft payload
- Checks if people are mentioned but not in contacts → creates `add_contact` suggestion
- Inserts rows into `review_queue` with `status: 'pending'`

This runs inside the existing `processInBackground` so no extra latency.

### 3. New page: `src/pages/ReviewQueue.tsx`

- Fetches `review_queue` where `status = 'pending'` ordered by created_at desc
- Each card shows: suggestion type icon, title, description, source note link
- Action buttons per type:
  - **Add Event to Temerio**: opens `CreateEventDialog` pre-filled from payload
  - **Add Event to Cherishly**: opens deep-link or forwards via `send-to-temerio`-style function
  - **Add Contact**: navigates to People with pre-filled data
  - **Dismiss**: marks `status = 'dismissed'`
- Accepting marks `status = 'accepted'`

### 4. Sidebar: add "Review" link with badge

Add to `DashboardSidebar.tsx` between "Actions" and "Weekly Review". Show a count badge of pending items using a lightweight query.

### 5. Route: add `/dashboard/review` in `App.tsx`

### 6. Update docs with Review Queue section

## Technical details

- The suggestion generation in `process-note` uses the already-extracted metadata (no additional LLM call, no extra credits)
- Connected apps are checked via the `connected_apps` table to only suggest apps the user has linked
- The `payload` JSONB stores the pre-filled EventDraft or contact data so the user can review and confirm with one click

