/**
 * Registers and renews Google Drive push channels.
 *
 * Drive watch channels expire (max ~1 week), so this runs on a schedule and
 * (re)registers any connection whose channel is missing or close to expiring.
 * Called with the service role key by pg_cron, or by gdrive-proxy right after
 * a user picks a folder.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const GATEWAY = "https://connector-gateway.lovable.dev";
const CONNECTOR_ID = "google_drive";
const WEBHOOK_URL = `${SUPABASE_URL.replace(".supabase.co", ".functions.supabase.co")}/gdrive-webhook`;

// Renew when less than 12 hours of channel life remain.
const RENEW_WINDOW_MS = 12 * 60 * 60 * 1000;
const CHANNEL_TTL_MS = 6 * 24 * 60 * 60 * 1000; // 6 days

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function gatewayHeaders(connectionKey: string) {
  return {
    Authorization: `Bearer ${Deno.env.get("LOVABLE_API_KEY")}`,
    "X-Client-Api-Key": Deno.env.get("GOOGLE_DRIVE_APP_USER_CONNECTOR_CLIENT_API_KEY") ?? "",
    "X-Connection-Api-Key": connectionKey,
    "Content-Type": "application/json",
  };
}

interface Conn {
  user_id: string;
  connection_key: string;
  watch_folder_id: string | null;
  channel_id: string | null;
  channel_expires_at: string | null;
  start_page_token: string | null;
}

async function stopChannel(conn: Conn) {
  if (!conn.channel_id) return;
  try {
    await fetch(`${GATEWAY}/${CONNECTOR_ID}/drive/v3/channels/stop`, {
      method: "POST",
      headers: gatewayHeaders(conn.connection_key),
      body: JSON.stringify({ id: conn.channel_id }),
    });
  } catch (e) {
    console.warn("channel stop failed (non-fatal)", e);
  }
}

async function registerChannel(conn: Conn): Promise<boolean> {
  // Drive's changes.watch needs a page token to anchor the change stream.
  let pageToken = conn.start_page_token;
  if (!pageToken) {
    const tokenRes = await fetch(
      `${GATEWAY}/${CONNECTOR_ID}/drive/v3/changes/startPageToken?supportsAllDrives=true`,
      { headers: gatewayHeaders(conn.connection_key) },
    );
    if (!tokenRes.ok) {
      console.error(`startPageToken failed [${tokenRes.status}]: ${await tokenRes.text()}`);
      return false;
    }
    pageToken = ((await tokenRes.json()) as { startPageToken?: string }).startPageToken ?? null;
    if (!pageToken) return false;
  }

  const channelId = crypto.randomUUID();
  const channelToken = crypto.randomUUID();
  const expiration = Date.now() + CHANNEL_TTL_MS;

  const res = await fetch(
    `${GATEWAY}/${CONNECTOR_ID}/drive/v3/changes/watch?pageToken=${encodeURIComponent(pageToken)}&supportsAllDrives=true&includeItemsFromAllDrives=true`,
    {
      method: "POST",
      headers: gatewayHeaders(conn.connection_key),
      body: JSON.stringify({
        id: channelId,
        type: "web_hook",
        address: WEBHOOK_URL,
        token: channelToken,
        expiration: String(expiration),
      }),
    },
  );

  if (!res.ok) {
    const details = await res.text();
    console.error(`changes.watch failed [${res.status}]: ${details}`);
    await admin
      .from("gdrive_connections")
      .update({
        last_error:
          "Live updates unavailable — falling back to periodic checks. Scans still import, just a little slower.",
      })
      .eq("user_id", conn.user_id);
    return false;
  }

  const body = (await res.json()) as { expiration?: string };
  const expiresAt = new Date(Number(body.expiration ?? expiration)).toISOString();

  await admin
    .from("gdrive_connections")
    .update({
      channel_id: channelId,
      channel_token: channelToken,
      channel_expires_at: expiresAt,
      start_page_token: pageToken,
      last_error: null,
    })
    .eq("user_id", conn.user_id);

  return true;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const token = (req.headers.get("Authorization") ?? "").replace("Bearer ", "");
  if (token !== SERVICE_ROLE_KEY) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const body = await req.json().catch(() => ({} as Record<string, unknown>));
    const force = body.force === true;

    let query = admin
      .from("gdrive_connections")
      .select("user_id, connection_key, watch_folder_id, channel_id, channel_expires_at, start_page_token")
      .eq("sync_enabled", true)
      .not("connection_key", "is", null)
      .not("watch_folder_id", "is", null);
    if (typeof body.user_id === "string") query = query.eq("user_id", body.user_id);

    const { data, error } = await query;
    if (error) throw error;

    const now = Date.now();
    const due = ((data ?? []) as Conn[]).filter((c) => {
      if (force) return true;
      if (!c.channel_id || !c.channel_expires_at) return true;
      return new Date(c.channel_expires_at).getTime() - now < RENEW_WINDOW_MS;
    });

    let renewed = 0;
    for (const conn of due) {
      try {
        if (conn.channel_id) await stopChannel(conn);
        if (await registerChannel(conn)) renewed += 1;
      } catch (e) {
        console.error("channel registration failed for", conn.user_id, e);
      }
    }

    return new Response(JSON.stringify({ ok: true, checked: (data ?? []).length, renewed }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("gdrive-watch-maintenance error", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unexpected error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
