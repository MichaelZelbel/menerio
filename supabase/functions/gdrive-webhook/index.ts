/**
 * Google Drive push notification receiver.
 *
 * Drive posts a header-only ping here whenever the watched folder changes.
 * We verify the channel token, then kick off gdrive-sync for that user so the
 * import happens within seconds instead of waiting for the polling backstop.
 *
 * Public endpoint: Google cannot send a JWT. Authenticity comes from the
 * random per-user channel token, which only Google knows.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204 });

  try {
    const channelId = req.headers.get("X-Goog-Channel-ID");
    const token = req.headers.get("X-Goog-Channel-Token");
    const state = req.headers.get("X-Goog-Resource-State");

    if (!channelId || !token) return new Response("ok", { status: 200 });

    const { data: conn } = await admin
      .from("gdrive_connections")
      .select("user_id, channel_token, sync_enabled")
      .eq("channel_id", channelId)
      .maybeSingle();

    // Unknown or mismatched channel — acknowledge so Google stops retrying.
    if (!conn || conn.channel_token !== token) return new Response("ok", { status: 200 });

    await admin
      .from("gdrive_connections")
      .update({ last_webhook_at: new Date().toISOString() })
      .eq("user_id", conn.user_id);

    // "sync" is the initial handshake ping; nothing changed yet.
    if (state === "sync" || conn.sync_enabled === false) {
      return new Response("ok", { status: 200 });
    }

    // @ts-expect-error EdgeRuntime is a Supabase global not in TS scope
    EdgeRuntime.waitUntil(
      fetch(`${SUPABASE_URL}/functions/v1/gdrive-sync`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ user_id: conn.user_id }),
      }).catch((e) => console.error("sync trigger failed", e)),
    );

    return new Response("ok", { status: 200 });
  } catch (e) {
    console.error("gdrive-webhook error", e);
    // Always 200 — a non-2xx makes Google retry and eventually kill the channel.
    return new Response("ok", { status: 200 });
  }
});
