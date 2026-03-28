import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
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
    // --- Auth: verify caller ---
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return json({ error: "Unauthorized" }, 401);
    }

    const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const supabaseUser = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });

    const token = authHeader.replace("Bearer ", "");
    const { data: claims, error: claimsErr } = await supabaseUser.auth.getClaims(token);
    if (claimsErr || !claims?.claims?.sub) {
      return json({ error: "Unauthorized" }, 401);
    }
    const userId = claims.claims.sub as string;

    // --- Parse body ---
    const { note_id, field_changes } = await req.json();
    if (!note_id || !field_changes || typeof field_changes !== "object") {
      return json({ error: "note_id and field_changes are required" }, 400);
    }

    // --- Load note (service role to bypass RLS, but check ownership) ---
    const { data: note, error: noteErr } = await supabaseAdmin
      .from("notes")
      .select("id, user_id, source_app, source_id, is_external, sync_status")
      .eq("id", note_id)
      .single();

    if (noteErr || !note) {
      return json({ error: "Note not found" }, 404);
    }
    if (note.user_id !== userId) {
      return json({ error: "Unauthorized — not your note" }, 403);
    }
    if (!note.is_external) {
      return json({ error: "Only external notes can be patched" }, 400);
    }
    if (!note.source_app) {
      return json({ error: "Note has no source_app" }, 400);
    }

    // --- Load connected app ---
    const { data: app, error: appErr } = await supabaseAdmin
      .from("connected_apps")
      .select("id, display_name, webhook_url, api_key, is_active")
      .eq("user_id", userId)
      .eq("app_name", note.source_app)
      .single();

    if (appErr || !app) {
      return json({ error: `No connected app found for "${note.source_app}"` }, 404);
    }
    if (!app.is_active) {
      return json({ error: `App "${app.display_name}" is deactivated` }, 400);
    }
    if (!app.webhook_url) {
      return json({ error: "App unterstützt keine Patch-Requests (keine webhook_url konfiguriert)" }, 400);
    }

    // --- Set sync_status to pending ---
    await supabaseAdmin
      .from("notes")
      .update({ sync_status: "pending" })
      .eq("id", note_id);

    // --- Send patch request to owner app ---
    const callbackUrl = `${SUPABASE_URL}/functions/v1/patch-response`;
    const patchPayload = {
      action: "patch_request",
      source_id: note.source_id,
      menerio_note_id: note_id,
      field_changes,
      requested_by_user_id: userId,
      callback_url: callbackUrl,
    };

    let webhookOk = false;
    try {
      const res = await fetch(app.webhook_url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": app.api_key,
        },
        body: JSON.stringify(patchPayload),
      });
      webhookOk = res.ok;
      // Consume body to prevent resource leak
      await res.text();
    } catch {
      webhookOk = false;
    }

    if (!webhookOk) {
      // Owner app unreachable — mark rejected
      await supabaseAdmin
        .from("notes")
        .update({ sync_status: "rejected" })
        .eq("id", note_id);

      return json(
        { error: `Owner-App "${app.display_name}" ist nicht erreichbar. Patch wurde abgelehnt.` },
        502
      );
    }

    return json({
      status: "pending",
      message: `Änderung wurde an ${app.display_name} gesendet`,
    });
  } catch (err) {
    console.error("send-patch error:", err);
    return json({ error: err.message || "Internal error" }, 500);
  }
});
