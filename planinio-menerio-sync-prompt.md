# Planinio → Menerio: One-Way Content Sync

## Overview

Implement a one-way sync from Planinio to Menerio. When a user creates or updates an Idea, Video (Content), or Post in Planinio, push it to Menerio as a note. The user connects once via an API key from Menerio.

## Menerio API Details

- **Menerio Supabase URL**: `https://tjeapelvjlmbxafsmjef.supabase.co`
- **Verify endpoint**: `POST {MENERIO_URL}/functions/v1/verify-connection`
- **Receive endpoint**: `POST {MENERIO_URL}/functions/v1/receive-note`
- **Auth header**: `x-api-key: <user's Menerio API key>`

## Step 1: Database — Store the Menerio Connection

Create a `menerio_connections` table:

```sql
create table public.menerio_connections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade not null,
  api_key text not null,
  menerio_url text not null default 'https://tjeapelvjlmbxafsmjef.supabase.co',
  is_active boolean default true,
  connection_status text default 'pending' check (connection_status in ('pending','active','revoked')),
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique(user_id)
);

alter table public.menerio_connections enable row level security;

create policy "Users manage own connection"
  on public.menerio_connections for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
```

## Step 2: Settings UI — Connect to Menerio

Add a "Menerio Connection" card in Settings:

1. **Input field**: "Menerio API Key" — paste the key from Menerio's App Integrations
2. **Connect button**: saves the key, then calls `verify-connection` (see below)
3. **Status badge**: Pending → Connected (green) once handshake succeeds
4. **Toggle**: Enable/disable sync
5. **Disconnect**: Delete the connection row

### Handshake flow

When the user clicks "Connect":

```typescript
// 1. Save key to menerio_connections table
// 2. Call verify-connection
const res = await fetch(`${menerioUrl}/functions/v1/verify-connection`, {
  method: "POST",
  headers: { "x-api-key": apiKey, "Content-Type": "application/json" },
});
const data = await res.json();
// 3. If data.ok → update connection_status to 'active'
// 4. Show success toast with data.user_display_name
```

## Step 3: Edge Function — `push-to-menerio`

Create `supabase/functions/push-to-menerio/index.ts`.

This function is called from the client after create/update mutations on ideas, videos, or posts.

### Auth & Setup

```typescript
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
```

### Request body

```typescript
interface PushRequest {
  content_type: "idea" | "video" | "post";
  content_id: string;
}
```

### Mapping Logic

The function fetches the content from the local DB, then maps it:

#### Ideas → Menerio `idea`

```typescript
{
  source_id: `planinio-idea-${idea.id}`,
  source_app: "planinio",
  entity_type: "idea",
  title: idea.working_title || "Untitled Idea",
  body: [
    idea.core_concept && `## Core Concept\n${idea.core_concept}`,
    idea.angle && `## Angle\n${idea.angle}`,
    idea.format && `**Format:** ${idea.format}`,
    idea.maturity && `**Maturity:** ${idea.maturity}`,
    idea.hook_variations?.length && `## Hooks\n${idea.hook_variations.map((h, i) => `${i+1}. ${h}`).join("\n")}`,
    idea.constraints && `## Constraints\n${idea.constraints}`,
  ].filter(Boolean).join("\n\n"),
  source_url: "https://planino-design-harmony.lovable.app/dashboard/ideas",
  tags: ["planinio", "idea", idea.maturity].filter(Boolean),
  structured_fields: {
    format: idea.format,
    maturity: idea.maturity,
    angle: idea.angle,
    constraints: idea.constraints,
  },
}
```

#### Videos → Menerio `document`

```typescript
{
  source_id: `planinio-video-${video.id}`,
  source_app: "planinio",
  entity_type: "document",
  title: video.title || "Untitled Content",
  body: [
    video.hook && `## Hook\n${video.hook}`,
    video.teleprompter_script && `## Script\n${video.teleprompter_script}`,
    video.on_screen_steps?.length && `## On-Screen Steps\n${video.on_screen_steps.map((s, i) => `${i+1}. ${s}`).join("\n")}`,
    `**Type:** ${video.content_type || "video"}`,
    video.orientation && `**Orientation:** ${video.orientation}`,
    video.production_status && `**Status:** ${video.production_status}`,
  ].filter(Boolean).join("\n\n"),
  source_url: "https://planino-design-harmony.lovable.app/dashboard/content",
  tags: ["planinio", "content", video.content_type].filter(Boolean),
  structured_fields: {
    content_type: video.content_type,
    orientation: video.orientation,
    production_status: video.production_status,
  },
}
```

#### Posts → Menerio `prompt`

```typescript
{
  source_id: `planinio-post-${post.id}`,
  source_app: "planinio",
  entity_type: "prompt",
  title: post.headline || (post.post_text?.substring(0, 60) + "…") || "Untitled Post",
  body: [
    post.post_text && `## Post\n${post.post_text}`,
    post.first_comment && `## First Comment\n${post.first_comment}`,
    post.hashtags?.length && `**Hashtags:** ${post.hashtags.join(" ")}`,
    post.platform && `**Platform:** ${post.platform}`,
    post.status && `**Status:** ${post.status}`,
    post.scheduled_at && `**Scheduled:** ${post.scheduled_at}`,
    post.posted_at && `**Posted:** ${post.posted_at}`,
  ].filter(Boolean).join("\n\n"),
  source_url: "https://planino-design-harmony.lovable.app/dashboard/posts",
  tags: ["planinio", "post", post.platform, post.status].filter(Boolean),
  structured_fields: {
    platform: post.platform,
    content_type: post.content_type,
    status: post.status,
    scheduled_at: post.scheduled_at,
    posted_at: post.posted_at,
  },
}
```

### Sending to Menerio

```typescript
// Fetch user's menerio connection
const { data: conn } = await supabase
  .from("menerio_connections")
  .select("api_key, menerio_url, is_active")
  .eq("user_id", userId)
  .eq("is_active", true)
  .single();

if (!conn) return json({ error: "no active menerio connection" }, 400);

// Push to Menerio
const res = await fetch(`${conn.menerio_url}/functions/v1/receive-note`, {
  method: "POST",
  headers: {
    "x-api-key": conn.api_key,
    "Content-Type": "application/json",
  },
  body: JSON.stringify(payload),
});
```

## Step 4: Trigger Sync from Client

After each successful create/update mutation on ideas, videos, or posts, call the edge function:

```typescript
// In your mutation's onSuccess callback:
const syncToMenerio = async (contentType: "idea" | "video" | "post", contentId: string) => {
  try {
    await supabase.functions.invoke("push-to-menerio", {
      body: { content_type: contentType, content_id: contentId },
    });
  } catch (err) {
    console.warn("Menerio sync failed (non-blocking):", err);
  }
};
```

Make this fire-and-forget — don't block the UI on sync results.

## Step 5: Add to `supabase/config.toml`

```toml
[functions.push-to-menerio]
verify_jwt = true
```

## Summary

| Component | What to build |
|---|---|
| `menerio_connections` table | Store API key + connection status |
| Settings UI card | Connect/disconnect with handshake |
| `push-to-menerio` edge function | Map & push ideas/videos/posts |
| Mutation hooks | Fire-and-forget sync after create/update |

No changes needed on the Menerio side — `receive-note`, `verify-connection`, and the UI already handle everything.
