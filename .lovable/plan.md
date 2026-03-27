

# Plan: "Create Event in Temerio" from Menerio Notes

## Overview

Add a button in the note editor that uses AI to extract event data from the note content, shows a pre-filled dialog matching Temerio's event fields, and submits the event to Temerio via a new edge function.

## Architecture

```text
Menerio NoteEditor
  └─ "Create Event" button (calendar icon in toolbar)
       └─ Calls Menerio edge function: extract-event
            └─ AI extracts: title, date, description, status, impact_level, etc.
       └─ Opens CreateEventDialog (pre-filled)
            └─ User edits fields, clicks "Create in Temerio"
                 └─ Calls Temerio edge function: create-moment-external
                      └─ Inserts into Temerio's moments table
```

## Cross-Project Authentication

Both projects use separate Supabase instances. To bridge them:
- A new Temerio edge function `create-moment-external` accepts requests authenticated via a shared API key (stored as `MENERIO_API_KEY` secret in Temerio, and `TEMERIO_BRIDGE_KEY` in Menerio).
- The edge function also requires the user's email to look up their Temerio user_id, so moments are attributed to the correct user.

## Steps

### 1. Create `extract-event` edge function in Menerio
- Accepts note content, uses OpenRouter/GPT-4o-mini to extract event fields matching Temerio's schema:
  - `title`, `description`, `happened_at`, `happened_end`, `status` (past_fact/future_plan/ongoing/unknown), `impact_level` (1-4), `confidence_date` (0-10), `confidence_truth` (0-10), `participants` (names)
- Returns the structured draft.

### 2. Create `create-moment-external` edge function in Temerio
- Accepts: API key header + event payload + user email
- Validates the shared API key
- Looks up user by email in Temerio's auth.users
- Inserts into `moments` table with `source: 'menerio'`
- Returns success/error

### 3. Create `CreateEventDialog` component in Menerio
- Same fields as Temerio's `AddEventDialog`: headline, start/end date, description, status, impact level, confidence (date), confidence (truth)
- Omit Temerio-only features (people picker, document attachment) for now
- Pre-populated from AI extraction
- "Create in Temerio" button calls the Temerio edge function

### 4. Add trigger button in NoteEditor
- Calendar/timeline icon in the note action toolbar
- On click: calls `extract-event` with note content, then opens dialog with pre-filled fields

### 5. Secrets setup
- Add `TEMERIO_BRIDGE_KEY` secret to Menerio (a shared key)
- Add `MENERIO_API_KEY` secret to Temerio (same value)
- Store Temerio's Supabase URL in Menerio's edge function config

## Temerio Event Fields (from AddEventDialog)

| Field | Type | Required |
|-------|------|----------|
| Headline (title) | text | Yes |
| Start Date (happened_at) | date | Yes |
| End Date (happened_end) | date | No |
| Description | text | No |
| Status | select: past_fact, future_plan, ongoing, unknown | No |
| Impact Level | 1-4 slider | No |
| Confidence Date | 0-10 slider | No |
| Confidence Truth | 0-10 slider | No |

## Technical Notes
- The `extract-event` function reuses the existing OpenRouter setup from `process-note`
- The dialog uses existing UI components (Dialog, Input, Select, Label, Slider)
- The Temerio edge function needs to be deployed in the Temerio project separately

