import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const GATEWAY = "https://connector-gateway.lovable.dev";
const CONNECTOR_ID = "google_drive";

const GOOGLE_SCOPES = [
  "https://www.googleapis.com/auth/userinfo.email",
  "https://www.googleapis.com/auth/userinfo.profile",
  "https://www.googleapis.com/auth/drive.readonly",
];

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function gatewayHeaders(extra: Record<string, string> = {}) {
  return {
    Authorization: `Bearer ${Deno.env.get("LOVABLE_API_KEY")}`,
    "X-Client-Api-Key": Deno.env.get("GOOGLE_DRIVE_APP_USER_CONNECTOR_CLIENT_API_KEY") ?? "",
    "Content-Type": "application/json",
    ...extra,
  };
}

/** Call the Google Drive API on behalf of one app user. */
async function callAsAppUser(connectionKey: string, path: string, init: RequestInit = {}) {
  return await fetch(`${GATEWAY}/${CONNECTOR_ID}${path}`, {
    ...init,
    headers: {
      ...gatewayHeaders(),
      "X-Connection-Api-Key": connectionKey,
      ...(init.headers as Record<string, string> | undefined),
    },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) return jsonResponse({ error: "Unauthorized" }, 401);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const userClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });
    const serviceClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const token = authHeader.replace("Bearer ", "");
    const { data: claimsData, error: claimsErr } = await userClient.auth.getClaims(token);
    if (claimsErr || !claimsData?.claims) return jsonResponse({ error: "Unauthorized" }, 401);
    const userId = claimsData.claims.sub as string;

    const body = await req.json().catch(() => ({}));
    const action = String(body.action || "");

    const getConn = async () => {
      const { data } = await serviceClient
        .from("gdrive_connections")
        .select("*")
        .eq("user_id", userId)
        .maybeSingle();
      return data as Record<string, unknown> | null;
    };

    const publicConn = (c: Record<string, unknown> | null) => {
      if (!c) return null;
      const { connection_key: _k, channel_token: _t, ...rest } = c;
      return { ...rest, connected: Boolean(_k) };
    };

    // ---- start_auth ------------------------------------------------------
    if (action === "start_auth") {
      const returnUrl = String(body.return_url || "");
      if (!/^https?:\/\//.test(returnUrl)) return jsonResponse({ error: "return_url required" }, 400);

      const res = await fetch(`${GATEWAY}/api/v1/app-users/oauth2/authorize`, {
        method: "POST",
        headers: gatewayHeaders(),
        body: JSON.stringify({
          connector_id: CONNECTOR_ID,
          app_user_id: userId,
          return_url: returnUrl,
          credentials_configuration: { scopes: GOOGLE_SCOPES },
        }),
      });
      const text = await res.text();
      if (!res.ok) {
        console.error(`authorize failed [${res.status}]: ${text}`);
        return jsonResponse({ error: "Could not start Google authorization", details: text }, res.status);
      }
      return jsonResponse(JSON.parse(text));
    }

    // ---- complete_auth ---------------------------------------------------
    if (action === "complete_auth") {
      const code = String(body.code || "");
      if (!code) return jsonResponse({ error: "code required" }, 400);

      const res = await fetch(`${GATEWAY}/api/v1/app-users/oauth2/exchange`, {
        method: "POST",
        headers: gatewayHeaders(),
        body: JSON.stringify({ code, connector_id: CONNECTOR_ID, app_user_id: userId }),
      });
      const text = await res.text();
      if (!res.ok) {
        console.error(`exchange failed [${res.status}]: ${text}`);
        return jsonResponse({ error: "Could not finish Google authorization", details: text }, res.status);
      }
      const payload = JSON.parse(text) as Record<string, string>;
      const connectionKey =
        payload.connection_key || payload.connection_api_key || payload.api_key || payload.key;
      if (!connectionKey) {
        console.error("exchange returned no connection key:", text);
        return jsonResponse({ error: "Google did not return a connection key" }, 500);
      }

      // Identify the connected Google account (best effort).
      let email: string | null = null;
      try {
        const about = await callAsAppUser(connectionKey, "/drive/v3/about?fields=user");
        if (about.ok) {
          const j = await about.json();
          email = j?.user?.emailAddress ?? null;
        } else {
          console.error(`about failed [${about.status}]: ${await about.text()}`);
        }
      } catch (e) {
        console.error("about lookup failed", e);
      }

      const { error: upsertErr } = await serviceClient.from("gdrive_connections").upsert(
        {
          user_id: userId,
          connection_key: connectionKey,
          google_email: email,
          sync_enabled: true,
          last_error: null,
        },
        { onConflict: "user_id" },
      );
      if (upsertErr) {
        console.error("failed to store gdrive connection", upsertErr);
        return jsonResponse({ error: "Could not save the connection" }, 500);
      }

      return jsonResponse({ status: "connected", google_email: email });
    }

    // ---- status ----------------------------------------------------------
    if (action === "status") {
      return jsonResponse({ connection: publicConn(await getConn()) });
    }

    // ---- list_folders ----------------------------------------------------
    if (action === "list_folders") {
      const conn = await getConn();
      const key = conn?.connection_key as string | undefined;
      if (!key) return jsonResponse({ error: "Google Drive is not connected" }, 400);

      const parent = typeof body.parent_id === "string" && body.parent_id ? body.parent_id : "root";
      const q = `mimeType='application/vnd.google-apps.folder' and trashed=false and '${parent.replace(/'/g, "")}' in parents`;
      const url =
        `/drive/v3/files?q=${encodeURIComponent(q)}` +
        `&fields=${encodeURIComponent("files(id,name)")}&pageSize=200&orderBy=name` +
        `&supportsAllDrives=true&includeItemsFromAllDrives=true`;

      const res = await callAsAppUser(key, url);
      const text = await res.text();
      if (!res.ok) {
        console.error(`list_folders failed [${res.status}]: ${text}`);
        return jsonResponse({ error: "Could not list Drive folders", status: res.status, details: text }, res.status);
      }
      const parsed = JSON.parse(text) as { files?: Array<{ id: string; name: string }> };
      return jsonResponse({ parent_id: parent, folders: parsed.files ?? [] });
    }

    // ---- save_settings ---------------------------------------------------
    if (action === "save_settings") {
      const updates: Record<string, unknown> = {};
      if (typeof body.watch_folder_id === "string") updates.watch_folder_id = body.watch_folder_id || null;
      if (typeof body.watch_folder_name === "string") updates.watch_folder_name = body.watch_folder_name || null;
      if (typeof body.target_note_folder === "string") {
        const folder = body.target_note_folder.trim().replace(/^\/+|\/+$/g, "");
        updates.target_note_folder = folder || "auto-import";
      }
      if (typeof body.sync_enabled === "boolean") updates.sync_enabled = body.sync_enabled;
      if (Object.keys(updates).length === 0) return jsonResponse({ error: "Nothing to update" }, 400);

      const { error } = await serviceClient
        .from("gdrive_connections")
        .update(updates)
        .eq("user_id", userId);
      if (error) {
        console.error("save_settings failed", error);
        return jsonResponse({ error: "Could not save settings" }, 500);
      }
      return jsonResponse({ connection: publicConn(await getConn()) });
    }

    // ---- disconnect ------------------------------------------------------
    if (action === "disconnect") {
      const { error } = await serviceClient.from("gdrive_connections").delete().eq("user_id", userId);
      if (error) {
        console.error("disconnect failed", error);
        return jsonResponse({ error: "Could not disconnect" }, 500);
      }
      return jsonResponse({ status: "disconnected" });
    }

    return jsonResponse({ error: `Unknown action: ${action}` }, 400);
  } catch (e) {
    console.error("gdrive-proxy error", e);
    return jsonResponse({ error: e instanceof Error ? e.message : "Unexpected error" }, 500);
  }
});
