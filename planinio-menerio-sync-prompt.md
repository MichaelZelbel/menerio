# Planinio → Menerio: One-Way Content Sync

## Overview

Implement a one-way sync from Planinio to Menerio. When a user creates or updates an **Idea**, **Video** (Content), or **Post** in Planinio, push it to Menerio as a note. The user connects once via an API key obtained from Menerio's Settings → App Integrations.

Menerio is a personal knowledge-management app. It already has:
- A `receive-note` edge function that accepts inbound notes
- A `verify-connection` endpoint for the handshake
- An `ExternalNotePanel` UI that shows "Open in Planinio" via `source_url`

**No changes are needed on the Menerio side.**

---

## Menerio API Details

| Item | Value |
|---|---|
| Menerio Supabase URL | `https://tjeapelvjlmbxafsmjef.supabase.co` |
| Verify endpoint | `POST {MENERIO_URL}/functions/v1/verify-connection` |
| Receive endpoint | `POST {MENERIO_URL}/functions/v1/receive-note` |
| Auth header | `x-api-key: <user's Menerio API key>` |

---

## Planinio's Existing Data Model (for reference)

These types already exist in `src/hooks/useContentOps.ts`:

```typescript
interface Idea {
  id: string;
  user_id: string;
  working_title: string;
  core_concept: string | null;
  format: string | null;
  angle: string | null;
  hook_variations: string[] | null;
  constraints: Record<string, unknown> | null;
  maturity: string;
  derived_from_idea_id: string | null;
  created_at: string;
  updated_at: string;
}

interface Video {
  id: string;
  user_id: string;
  idea_id: string | null;
  title: string;
  content_type: string;
  hook: string | null;
  teleprompter_script: string | null;
  production_status: string;
  raw_path: string | null;
  edited_path: string | null;
  thumbnail_path: string | null;
  paths: ContentPath[];
  orientation: string;
  derived_from_video_id: string | null;
  created_at: string;
  updated_at: string;
}

interface Post {
  id: string;
  user_id: string;
  video_id: string | null;
  idea_id: string | null;
  content_type: string;
  platform: string;
  headline: string | null;
  post_text: string;
  hashtags: string | null;
  first_comment: string | null;
  pinned_comment: string | null;
  email_subject: string | null;
  email_preview: string | null;
  status: string;
  scheduled_at: string | null;
  posted_at: string | null;
  post_url: string | null;
  media_url: string | null;
  metrics_json: Record<string, unknown> | null;
  derived_from_post_id: string | null;
  created_at: string;
  updated_at: string;
}
```

---

## Existing Mutation Hooks (in `src/hooks/useContentOps.ts`)

- `useUpsertIdea()` — creates/updates ideas
- `useUpsertVideo()` — creates/updates videos
- `useUpsertPost()` — creates/updates posts
- `useMarkPosted()` — marks a post as posted
- `useCreatePlatformDrafts()` — creates draft posts for platforms

---

## Existing Settings Page

`src/pages/Settings.tsx` has a `Tabs` layout with tabs: Profile, Avatar, Integrations, AI Credits, Subscription, Account, Danger.

The **Integrations** tab currently only contains a `GoogleIntegrationCard`. The Menerio connection card should be added here as a second card.

---

## Step 1: Database — `menerio_connections` Table

Create a migration:

```sql
create table public.menerio_connections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade not null,
  api_key text not null,
  menerio_url text not null default 'https://tjeapelvjlmbxafsmjef.supabase.co',
  is_active boolean default true,
  connection_status text default 'pending',
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique(user_id)
);

alter table public.menerio_connections enable row level security;

create policy "Users manage own menerio connection"
  on public.menerio_connections for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
```

---

## Step 2: Settings UI — Menerio Connection Card

Create a new component `src/components/settings/MenerioIntegration.tsx`.

### UI Design

A card similar to `GoogleIntegrationCard` with:

1. **Header**: "Menerio" with description "Connect to sync your ideas, content & posts to Menerio."
2. **Not connected state**:
   - Input field: "Menerio API Key" (password type with show/hide toggle)
   - Helper text: "Get this key from Menerio → Settings → App Integrations → Connect Planinio"
   - "Connect" button
3. **Connected state**:
   - Green "Connected" badge
   - Toggle to enable/disable sync
   - "Disconnect" button (with confirmation dialog)
4. **Pending state** (after saving key, before handshake completes):
   - Yellow "Awaiting handshake…" badge
   - Helper: "Verifying connection with Menerio…"

### Connection Flow

```typescript
const handleConnect = async () => {
  // 1. Save key to menerio_connections
  await supabase.from("menerio_connections").upsert({
    user_id: user.id,
    api_key: apiKeyInput.trim(),
    connection_status: "pending",
  });

  // 2. Verify with Menerio
  const res = await fetch(
    "https://tjeapelvjlmbxafsmjef.supabase.co/functions/v1/verify-connection",
    {
      method: "POST",
      headers: {
        "x-api-key": apiKeyInput.trim(),
        "Content-Type": "application/json",
      },
    }
  );
  const data = await res.json();

  if (data.ok) {
    // 3. Update status to active
    await supabase
      .from("menerio_connections")
      .update({ connection_status: "active" })
      .eq("user_id", user.id);
    
    toast({ title: "Connected to Menerio!", description: `Linked to ${data.user_display_name || "your account"}` });
  } else {
    // Remove the connection on failure
    await supabase.from("menerio_connections").delete().eq("user_id", user.id);
    toast({ variant: "destructive", title: "Connection failed", description: data.error || "Invalid API key" });
  }
};
```

### Add to Settings Page

In `src/pages/Settings.tsx`, import `MenerioIntegration` and add it below `GoogleIntegrationCard` in the Integrations tab:

```tsx
<TabsContent value="integrations">
  <div className="space-y-4">
    <GoogleIntegrationCard />
    <MenerioIntegration />
  </div>
</TabsContent>
```

---

## Step 3: Edge Function — `push-to-menerio`

Create `supabase/functions/push-to-menerio/index.ts`.

Add to `supabase/config.toml`:
```toml
[functions.push-to-menerio]
verify_jwt = false
```

### Full Implementation

```typescript
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const PLANINIO_URL = "https://planino-design-harmony.lovable.app";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // Authenticate the calling user via JWT
    const authHeader = req.headers.get("authorization") || "";
    const token = authHeader.replace("Bearer ", "");
    const {
      data: { user },
      error: authErr,
    } = await supabase.auth.getUser(token);
    if (authErr || !user) return json({ error: "unauthorized" }, 401);

    const { content_type, content_id } = await req.json();
    if (!content_type || !content_id) {
      return json({ error: "content_type and content_id required" }, 400);
    }

    // Fetch user's Menerio connection
    const { data: conn, error: connErr } = await supabase
      .from("menerio_connections")
      .select("api_key, menerio_url, is_active, connection_status")
      .eq("user_id", user.id)
      .single();

    if (connErr || !conn) {
      return json({ error: "no Menerio connection found" }, 400);
    }
    if (!conn.is_active || conn.connection_status !== "active") {
      return json({ error: "Menerio connection is not active" }, 400);
    }

    // Build the payload based on content type
    let payload: Record<string, unknown>;

    if (content_type === "idea") {
      const { data: idea, error } = await supabase
        .from("ideas")
        .select("*")
        .eq("id", content_id)
        .single();
      if (error || !idea) return json({ error: "idea not found" }, 404);

      const bodyParts = [
        idea.core_concept && `## Core Concept\n${idea.core_concept}`,
        idea.angle && `## Angle\n${idea.angle}`,
        idea.format && `**Format:** ${idea.format}`,
        idea.maturity && `**Maturity:** ${idea.maturity}`,
        idea.hook_variations?.length &&
          `## Hooks\n${idea.hook_variations
            .map((h: string, i: number) => `${i + 1}. ${h}`)
            .join("\n")}`,
        idea.constraints &&
          `## Constraints\n${JSON.stringify(idea.constraints, null, 2)}`,
      ].filter(Boolean);

      payload = {
        source_id: `planinio-idea-${idea.id}`,
        source_app: "planinio",
        entity_type: "idea",
        title: idea.working_title || "Untitled Idea",
        body: bodyParts.join("\n\n"),
        source_url: `${PLANINIO_URL}/dashboard/ideas`,
        tags: ["planinio", "idea", idea.maturity].filter(Boolean),
        structured_fields: {
          format: idea.format,
          maturity: idea.maturity,
          angle: idea.angle,
          constraints: idea.constraints,
        },
      };
    } else if (content_type === "video") {
      const { data: video, error } = await supabase
        .from("videos")
        .select("*")
        .eq("id", content_id)
        .single();
      if (error || !video) return json({ error: "video not found" }, 404);

      const bodyParts = [
        video.hook && `## Hook\n${video.hook}`,
        video.teleprompter_script &&
          `## Script\n${video.teleprompter_script}`,
        `**Type:** ${video.content_type || "video"}`,
        video.orientation && `**Orientation:** ${video.orientation}`,
        video.production_status &&
          `**Status:** ${video.production_status}`,
      ].filter(Boolean);

      payload = {
        source_id: `planinio-video-${video.id}`,
        source_app: "planinio",
        entity_type: "document",
        title: video.title || "Untitled Content",
        body: bodyParts.join("\n\n"),
        source_url: `${PLANINIO_URL}/dashboard/content`,
        tags: ["planinio", "content", video.content_type].filter(Boolean),
        structured_fields: {
          content_type: video.content_type,
          orientation: video.orientation,
          production_status: video.production_status,
        },
      };
    } else if (content_type === "post") {
      const { data: post, error } = await supabase
        .from("posts")
        .select("*")
        .eq("id", content_id)
        .single();
      if (error || !post) return json({ error: "post not found" }, 404);

      const bodyParts = [
        post.post_text && `## Post\n${post.post_text}`,
        post.first_comment && `## First Comment\n${post.first_comment}`,
        post.hashtags && `**Hashtags:** ${post.hashtags}`,
        post.platform && `**Platform:** ${post.platform}`,
        post.status && `**Status:** ${post.status}`,
        post.scheduled_at && `**Scheduled:** ${post.scheduled_at}`,
        post.posted_at && `**Posted:** ${post.posted_at}`,
      ].filter(Boolean);

      payload = {
        source_id: `planinio-post-${post.id}`,
        source_app: "planinio",
        entity_type: "prompt",
        title:
          post.headline ||
          (post.post_text?.substring(0, 60) + "…") ||
          "Untitled Post",
        body: bodyParts.join("\n\n"),
        source_url: `${PLANINIO_URL}/dashboard/posts`,
        tags: ["planinio", "post", post.platform, post.status].filter(Boolean),
        structured_fields: {
          platform: post.platform,
          content_type: post.content_type,
          status: post.status,
          scheduled_at: post.scheduled_at,
          posted_at: post.posted_at,
        },
      };
    } else {
      return json({ error: `unknown content_type: ${content_type}` }, 400);
    }

    // Send to Menerio
    const menerioUrl = conn.menerio_url || "https://tjeapelvjlmbxafsmjef.supabase.co";
    const res = await fetch(`${menerioUrl}/functions/v1/receive-note`, {
      method: "POST",
      headers: {
        "x-api-key": conn.api_key,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    const result = await res.json();
    if (!res.ok) {
      console.error("Menerio rejected push:", result);
      return json({ error: "menerio_rejected", detail: result }, res.status);
    }

    return json({ ok: true, menerio_note_id: result.note_id });
  } catch (err) {
    console.error("push-to-menerio error:", err);
    return json({ error: (err as Error).message }, 500);
  }
});
```

---

## Step 4: Trigger Sync from Mutation Hooks

### Create a reusable sync helper

Create `src/lib/menerio-sync.ts`:

```typescript
import { supabase } from "@/integrations/supabase/client";

/**
 * Fire-and-forget push to Menerio.
 * Call after any idea/video/post create or update.
 */
export async function syncToMenerio(
  contentType: "idea" | "video" | "post",
  contentId: string
) {
  try {
    const { error } = await supabase.functions.invoke("push-to-menerio", {
      body: { content_type: contentType, content_id: contentId },
    });
    if (error) console.warn("Menerio sync failed (non-blocking):", error);
  } catch (err) {
    console.warn("Menerio sync failed (non-blocking):", err);
  }
}
```

### Wire into existing hooks

In `src/hooks/useContentOps.ts`, update the `onSuccess` callbacks of the upsert mutations:

```typescript
import { syncToMenerio } from "@/lib/menerio-sync";

// In useUpsertIdea:
onSuccess: (data) => {
  qc.invalidateQueries({ queryKey: ["ideas"] });
  if (data?.id) syncToMenerio("idea", data.id);
},

// In useUpsertVideo:
onSuccess: (data) => {
  qc.invalidateQueries({ queryKey: ["videos"] });
  if (data?.id) syncToMenerio("video", data.id);
},

// In useUpsertPost:
onSuccess: (data) => {
  qc.invalidateQueries({ queryKey: ["posts"] });
  if (data?.id) syncToMenerio("post", data.id);
},

// In useMarkPosted:
onSuccess: (data) => {
  qc.invalidateQueries({ queryKey: ["posts"] });
  if (data?.id) syncToMenerio("post", data.id);
},
```

This is fire-and-forget — the UI never blocks on sync results.

---

## Step 5: Config Updates

### `supabase/config.toml`

Add:

```toml
[functions.push-to-menerio]
verify_jwt = false
```

---

## Summary of Files to Create / Modify

| File | Action | Description |
|---|---|---|
| Migration | Create | `menerio_connections` table with RLS |
| `src/components/settings/MenerioIntegration.tsx` | Create | Connection card UI |
| `src/pages/Settings.tsx` | Modify | Add `<MenerioIntegration />` to Integrations tab |
| `supabase/functions/push-to-menerio/index.ts` | Create | Edge function to map & push content to Menerio |
| `src/lib/menerio-sync.ts` | Create | Fire-and-forget sync helper |
| `src/hooks/useContentOps.ts` | Modify | Add `syncToMenerio()` calls to upsert `onSuccess` callbacks |
| `supabase/config.toml` | Modify | Add `push-to-menerio` function config |

---

## What Menerio Already Handles (no changes needed there)

- `receive-note` edge function upserts notes by `source_id` (idempotent)
- `ExternalNotePanel` shows "Open in Planinio" via `source_url`
- `NoteList` displays the external badge with `source_app: "planinio"`
- `process-note` auto-triggers AI enrichment (tags, embedding, connections) on received notes
- `verify-connection` upgrades `connection_status` from `pending` → `active`
- Planinio is already registered in Menerio's `KNOWN_APPS` registry

---

## User Flow (end-to-end)

1. User goes to **Menerio → Settings → App Integrations** → clicks **Connect** next to Planinio → copies the API key
2. User goes to **Planinio → Settings → Integrations** → pastes the API key → clicks **Connect**
3. Planinio calls `verify-connection` → Menerio upgrades status to `active` → both sides show "Connected"
4. User creates or edits an Idea/Video/Post in Planinio → `onSuccess` fires `syncToMenerio()` → content appears in Menerio as a note
5. In Menerio, the note shows an "Open in Planinio" button → clicking it opens the corresponding Planinio dashboard page
