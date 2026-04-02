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
    const apiKey = req.headers.get("x-api-key");
    if (!apiKey) {
      return json({ error: "unauthorized" }, 401);
    }

    // Look up the app by API key
    const { data: app, error: appErr } = await supabase
      .from("connected_apps")
      .select("id, user_id, app_name, display_name, connection_status, is_active")
      .eq("api_key", apiKey)
      .single();

    if (appErr || !app) {
      return json({ error: "unauthorized" }, 401);
    }

    if (app.connection_status === "revoked") {
      return json({ error: "connection has been revoked" }, 401);
    }

    if (app.connection_status === "active") {
      return json({ ok: true, already_connected: true, app_name: "menerio" }, 200);
    }

    // Upgrade pending → active
    const { error: updateErr } = await supabase
      .from("connected_apps")
      .update({ connection_status: "active" })
      .eq("id", app.id);

    if (updateErr) {
      console.error("Failed to update connection_status:", updateErr);
      return json({ error: "internal error" }, 500);
    }

    // Fetch user display name for the response
    const { data: profile } = await supabase
      .from("profiles")
      .select("display_name")
      .eq("id", app.user_id)
      .single();

    return json({
      ok: true,
      app_name: "menerio",
      user_display_name: profile?.display_name || null,
    }, 200);
  } catch (err) {
    console.error("verify-connection error:", err);
    return json({ error: (err as Error).message || "Internal error" }, 500);
  }
});
