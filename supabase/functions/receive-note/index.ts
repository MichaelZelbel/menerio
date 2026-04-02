import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-api-key, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
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
    // --- Auth via x-api-key header ---
    const apiKey = req.headers.get("x-api-key");
    if (!apiKey) {
      return json({ error: "unauthorized" }, 401);
    }

    const { data: app, error: appErr } = await supabase
      .from("connected_apps")
      .select("user_id, app_name, is_active, permissions")
      .eq("api_key", apiKey)
      .single();

    if (appErr || !app) {
      return json({ error: "unauthorized" }, 401);
    }
    if (!app.is_active) {
      return json({ error: "unauthorized — app is deactivated" }, 401);
    }

    const permissions = app.permissions as Record<string, boolean> | null;
    if (permissions && permissions.can_push_notes === false) {
      return json({ error: "forbidden — app does not have push permission" }, 403);
    }

    const userId = app.user_id as string;
    const appName = app.app_name as string;

    // --- Parse & validate body ---
    const body = await req.json();
    const { source_id, title, entity_type, tags, related, structured_fields, source_url, body: noteBody } = body;

    if (!source_id || typeof source_id !== "string") {
      return json({ error: "source_id is required (string)" }, 400);
    }
    if (!title || typeof title !== "string") {
      return json({ error: "title is required (string)" }, 400);
    }
    if (!noteBody || typeof noteBody !== "string") {
      return json({ error: "body is required (string)" }, 400);
    }

    const noteData = {
      user_id: userId,
      title,
      content: noteBody,
      entity_type: entity_type || null,
      tags: Array.isArray(tags) ? tags : [],
      related: Array.isArray(related) ? related : [],
      structured_fields: structured_fields && typeof structured_fields === "object" ? structured_fields : {},
      source_app: appName,
      source_id,
      source_url: source_url || null,
      is_external: true,
      sync_status: "synced",
    };

    // --- Upsert: check if note with same source_app + source_id + user_id exists ---
    const { data: existing } = await supabase
      .from("notes")
      .select("id")
      .eq("user_id", userId)
      .eq("source_app", appName)
      .eq("source_id", source_id)
      .maybeSingle();

    if (existing) {
      // UPDATE
      const { error: updateErr } = await supabase
        .from("notes")
        .update(noteData)
        .eq("id", existing.id);

      if (updateErr) {
        console.error("Update error:", updateErr);
        return json({ error: updateErr.message }, 500);
      }

      triggerProcessNote(existing.id);
      return json({ action: "updated", note_id: existing.id }, 200);
    } else {
      // INSERT
      const { data: inserted, error: insertErr } = await supabase
        .from("notes")
        .insert(noteData)
        .select("id")
        .single();

      if (insertErr) {
        console.error("Insert error:", insertErr);
        return json({ error: insertErr.message }, 500);
      }

      triggerProcessNote(inserted.id);
      return json({ action: "created", note_id: inserted.id }, 201);
    }
  } catch (err) {
    console.error("receive-note error:", err);
    return json({ error: err.message || "Internal error" }, 500);
  }
});

function triggerProcessNote(noteId: string) {
  fetch(`${SUPABASE_URL}/functions/v1/process-note`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ note_id: noteId }),
  }).catch((err) => console.error("process-note trigger error:", err));
}
