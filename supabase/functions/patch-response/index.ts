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
    // --- Auth via x-api-key ---
    const apiKey = req.headers.get("x-api-key");
    if (!apiKey) return json({ error: "unauthorized" }, 401);

    const { data: app, error: appErr } = await supabase
      .from("connected_apps")
      .select("user_id, app_name, is_active")
      .eq("api_key", apiKey)
      .single();

    if (appErr || !app) return json({ error: "unauthorized" }, 401);
    if (!app.is_active) return json({ error: "unauthorized — app is deactivated" }, 401);

    const userId = app.user_id as string;
    const appName = app.app_name as string;

    // --- Parse body ---
    const { menerio_note_id, source_id, action, updated_fields, reject_reason, body: updatedBody } = await req.json();

    if (!menerio_note_id) return json({ error: "menerio_note_id is required" }, 400);
    if (!action || !["ack", "reject"].includes(action)) {
      return json({ error: 'action must be "ack" or "reject"' }, 400);
    }

    // --- Load note ---
    const { data: note, error: noteErr } = await supabase
      .from("notes")
      .select("id, user_id, source_app, structured_fields")
      .eq("id", menerio_note_id)
      .single();

    if (noteErr || !note) return json({ error: "Note not found" }, 404);
    if (note.source_app !== appName) {
      return json({ error: "API key does not match note's source_app" }, 403);
    }
    if (note.user_id !== userId) {
      return json({ error: "unauthorized" }, 403);
    }

    const existingFields = (note.structured_fields as Record<string, unknown>) || {};

    if (action === "ack") {
      const updateData: Record<string, unknown> = { sync_status: "synced" };

      if (updated_fields && typeof updated_fields === "object") {
        updateData.structured_fields = { ...existingFields, ...updated_fields };
      }
      if (updatedBody && typeof updatedBody === "string") {
        updateData.content = updatedBody;
      }

      await supabase.from("notes").update(updateData).eq("id", menerio_note_id);

      // Log
      await supabase.from("sync_log").insert({
        user_id: userId,
        note_id: menerio_note_id,
        action: "ack_received",
        details: { source_id, updated_fields, had_body_update: !!updatedBody },
        source_app: appName,
      });

      return json({ status: "processed" });
    }

    if (action === "reject") {
      const updatedStructuredFields = {
        ...existingFields,
        _last_reject_reason: reject_reason || "No reason provided",
      };

      await supabase
        .from("notes")
        .update({ sync_status: "rejected", structured_fields: updatedStructuredFields })
        .eq("id", menerio_note_id);

      // Log
      await supabase.from("sync_log").insert({
        user_id: userId,
        note_id: menerio_note_id,
        action: "reject_received",
        details: { source_id, reject_reason },
        source_app: appName,
      });

      return json({ status: "processed" });
    }

    return json({ error: "Unexpected state" }, 500);
  } catch (err) {
    console.error("patch-response error:", err);
    return json({ error: err.message || "Internal error" }, 500);
  }
});
