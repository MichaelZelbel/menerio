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
    // Auth via x-api-key
    const apiKey = req.headers.get("x-api-key");
    if (!apiKey) return json({ error: "unauthorized" }, 401);

    const { data: app, error: appErr } = await supabase
      .from("connected_apps")
      .select("user_id, app_name, is_active")
      .eq("api_key", apiKey)
      .single();

    if (appErr || !app) return json({ error: "unauthorized" }, 401);
    if (!app.is_active) return json({ error: "unauthorized — app deactivated" }, 401);

    const userId = app.user_id as string;
    const appName = app.app_name as string;

    // Parse body
    const { menerio_note_id, source_id, source_url, source_app } = await req.json();

    if (!menerio_note_id) return json({ error: "menerio_note_id is required" }, 400);
    if (!source_id) return json({ error: "source_id is required" }, 400);

    // Load note
    const { data: note, error: noteErr } = await supabase
      .from("notes")
      .select("id, user_id, related")
      .eq("id", menerio_note_id)
      .single();

    if (noteErr || !note) return json({ error: "Note not found" }, 404);
    if (note.user_id !== userId) return json({ error: "unauthorized" }, 403);

    // Add to related array
    const existing = Array.isArray(note.related) ? note.related : [];
    const newEntry = {
      type: "linked_record",
      name: `${source_app || appName} record`,
      source_app: source_app || appName,
      source_id,
      source_url: source_url || null,
    };

    const updated = [...existing, newEntry];

    const { error: updateErr } = await supabase
      .from("notes")
      .update({ related: updated })
      .eq("id", menerio_note_id);

    if (updateErr) {
      console.error("Update error:", updateErr);
      return json({ error: updateErr.message }, 500);
    }

    // Log
    await supabase.from("sync_log").insert({
      user_id: userId,
      note_id: menerio_note_id,
      action: "note_linked",
      details: newEntry,
      source_app: source_app || appName,
    });

    return json({ status: "linked" });
  } catch (err) {
    console.error("link-note error:", err);
    return json({ error: err.message || "Internal error" }, 500);
  }
});
