

# One-Way Sync: Planinio → Menerio

## Overview

Sync Planinio's three content types (Ideas, Content/Videos, Posts) into Menerio as notes, with a one-click "Open in Planinio" button to jump back and edit.

## Planinio Data Model (from analysis)

| Planinio Table | Key Fields | Menerio entity_type |
|---|---|---|
| `ideas` | working_title, core_concept, angle, format, maturity, hook_variations, constraints | `idea` |
| `videos` | title, hook, teleprompter_script, content_type, orientation, production_status, on_screen_steps | `document` |
| `posts` | headline, post_text, platform, content_type, status, hashtags, first_comment, scheduled_at, posted_at | `prompt` |

Planinio Supabase URL: `https://suzqnyvfjbmnoipnlobk.supabase.co`
Planinio published URL: `https://planino-design-harmony.lovable.app`

Deep-link routes: `/dashboard/ideas`, `/dashboard/content`, `/dashboard/posts`

## Changes in Menerio

### 1. Add Planinio to KNOWN_APPS registry

In `src/components/settings/AppIntegrations.tsx`, add a new entry:

```text
id: "planinio"
name: "Planinio"
description: "Social media studio — syncs ideas, content & posts."
supabaseUrl: "https://suzqnyvfjbmnoipnlobk.supabase.co"
webhookPath: "/functions/v1/menerio-webhook"
icon: "📱"
```

### 2. Add PLANINIO_BRIDGE_KEY secret

A shared secret for bridge calls. Will request via the secrets tool.

### 3. No new edge functions needed on Menerio side

The existing `receive-note` endpoint already handles everything Planinio needs to push. It accepts `source_id`, `title`, `body`, `entity_type`, `tags`, `structured_fields`, and `source_url` — all sufficient for the three content types.

The `source_url` field will carry the deep link (e.g., `https://planino-design-harmony.lovable.app/dashboard/ideas`) and the existing `ExternalNotePanel` already renders "Open in Planinio" using `source_url`.

### 4. Markdown prompt for Planinio

Generate a copy-paste Markdown prompt file (`planinio-menerio-sync-prompt.md`) for the Planinio project to implement:

- **Connection handshake UI** in Settings: accept a Menerio API key, verify via `POST /verify-connection`
- **`push-to-menerio` edge function**: calls Menerio's `receive-note` with the `x-api-key` header. Maps each content type:

  **Ideas →**
  ```text
  source_id: "planinio-idea-{id}"
  entity_type: "idea"
  title: working_title
  body: Markdown with core_concept, angle, format, maturity, hooks
  source_url: "{PLANINIO_URL}/dashboard/ideas"
  tags: ["planinio", "idea", maturity]
  structured_fields: { format, maturity, angle, constraints }
  ```

  **Videos (Content) →**
  ```text
  source_id: "planinio-video-{id}"
  entity_type: "document"
  title: title
  body: Markdown with hook, teleprompter_script, on_screen_steps
  source_url: "{PLANINIO_URL}/dashboard/content"
  tags: ["planinio", "content", content_type]
  structured_fields: { content_type, orientation, production_status }
  ```

  **Posts →**
  ```text
  source_id: "planinio-post-{id}"
  entity_type: "prompt"
  title: headline || first 60 chars of post_text
  body: Markdown with post_text, first_comment, hashtags, platform details
  source_url: "{PLANINIO_URL}/dashboard/posts"
  tags: ["planinio", "post", platform, status]
  structured_fields: { platform, content_type, status, scheduled_at, posted_at }
  ```

- **Trigger hooks**: call `push-to-menerio` on insert/update of ideas, videos, posts (via database webhook or in the mutation hooks)

## Files touched

| File | Change |
|---|---|
| `src/components/settings/AppIntegrations.tsx` | Add Planinio to KNOWN_APPS |
| `planinio-menerio-sync-prompt.md` (new) | Implementation prompt for Planinio project |
| Secret: `PLANINIO_BRIDGE_KEY` | New secret for bridge auth |

## What already works (no changes needed)

- `receive-note` edge function handles the inbound upsert
- `ExternalNotePanel` renders "Open in Planinio" via `source_url`
- `NoteList` shows the orange external badge with `source_app`
- `process-note` auto-triggers AI enrichment on received notes

