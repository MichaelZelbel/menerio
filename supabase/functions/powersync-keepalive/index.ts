// Keeps the PowerSync Cloud instance from being deprovisioned for inactivity.
//
// WHY: PowerSync Cloud tears down instances that see no activity for a while.
// Menerio's instance was deprovisioned once already, which silently froze every
// local-first device. A plain liveness probe is served by the container without
// touching sync and may not count as activity, so this job authenticates like a
// real client and opens the sync stream for a couple of seconds.
//
// Invoked by pg_cron every 6 hours. No user input, no user data access beyond
// minting a short-lived session for one keepalive identity.
import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { isValidCronRequest } from "../_shared/cron-auth.ts";

const DEFAULT_POWERSYNC_URL =
  "https://6a5158557f33bac37ef5cf80.powersync.journeyapps.com";

const STREAM_READ_MS = 4_000;
const REQUEST_TIMEOUT_MS = 15_000;

type Result = {
  ok: boolean;
  host: string;
  authenticated: boolean;
  streamStatus?: number;
  bytes?: number;
  reachable?: boolean;
  error?: string;
};

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

// A real user JWT, obtained the only way service-role code can: generate a
// magic link for an existing account and immediately redeem its token hash.
// No password is stored anywhere.
async function mintUserToken(
  supabaseUrl: string,
  serviceKey: string,
): Promise<{ token: string; email: string } | { error: string }> {
  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  let email = Deno.env.get("POWERSYNC_KEEPALIVE_EMAIL") ?? "";
  if (!email) {
    const { data, error } = await admin.auth.admin.listUsers({
      page: 1,
      perPage: 1,
    });
    if (error) return { error: `listUsers failed: ${error.message}` };
    email = data.users[0]?.email ?? "";
    if (!email) return { error: "no auth user available for keepalive" };
  }

  const { data: linkData, error: linkError } =
    await admin.auth.admin.generateLink({ type: "magiclink", email });
  if (linkError || !linkData?.properties?.hashed_token) {
    return { error: `generateLink failed: ${linkError?.message ?? "no token"}` };
  }

  const anon = createClient(
    supabaseUrl,
    Deno.env.get("SUPABASE_ANON_KEY") ?? "",
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  const { data: session, error: otpError } = await anon.auth.verifyOtp({
    type: "magiclink",
    token_hash: linkData.properties.hashed_token,
  });
  if (otpError || !session?.session?.access_token) {
    return { error: `verifyOtp failed: ${otpError?.message ?? "no session"}` };
  }
  return { token: session.session.access_token, email };
}

// Open the sync stream, read whatever arrives for a few seconds, then close.
// Any 2xx means PowerSync accepted an authenticated client — that is the
// activity we want on the record.
async function touchSyncStream(
  powersyncUrl: string,
  token: string,
): Promise<{ status: number; bytes: number }> {
  const controller = new AbortController();
  const hardStop = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(`${powersyncUrl.replace(/\/$/, "")}/sync/stream`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ buckets: [], include_checksum: true, raw_data: true }),
      signal: controller.signal,
    });

    let bytes = 0;
    if (res.body) {
      const reader = res.body.getReader();
      const stopReading = setTimeout(() => controller.abort(), STREAM_READ_MS);
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          bytes += value?.byteLength ?? 0;
          if (bytes > 64_000) break;
        }
      } catch {
        /* aborting the read is the normal exit path */
      } finally {
        clearTimeout(stopReading);
        try {
          await reader.cancel();
        } catch {
          /* already closed */
        }
      }
    }
    return { status: res.status, bytes };
  } finally {
    clearTimeout(hardStop);
  }
}

// Last resort: at minimum make the host serve a request, so DNS and the
// container are exercised and the logs record whether it is even alive.
async function probeHost(powersyncUrl: string): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8_000);
  try {
    const res = await fetch(
      `${powersyncUrl.replace(/\/$/, "")}/probes/liveness`,
      { method: "GET", cache: "no-store", signal: controller.signal },
    );
    return res.status < 500;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

  // Only the pg_cron scheduler (x-cron-key, held in the database —
  // _shared/cron-auth.ts) or a service-role caller may run this. It mints a
  // real user session via auth.admin, so an open door here hands out
  // unlimited magic-link generation to anyone with the URL.
  const bearer = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  const isService = !!serviceKey && bearer === serviceKey;
  if (!isService && !(await isValidCronRequest(req))) {
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const powersyncUrl =
    Deno.env.get("POWERSYNC_URL")?.trim() || DEFAULT_POWERSYNC_URL;

  const result: Result = {
    ok: false,
    host: hostOf(powersyncUrl),
    authenticated: false,
  };

  try {
    const minted = await mintUserToken(supabaseUrl, serviceKey);
    if ("error" in minted) {
      result.error = minted.error;
    } else {
      const { status, bytes } = await touchSyncStream(powersyncUrl, minted.token);
      result.authenticated = status >= 200 && status < 300;
      result.streamStatus = status;
      result.bytes = bytes;
      result.ok = result.authenticated;
    }
  } catch (error) {
    result.error = error instanceof Error ? error.message : String(error);
  }

  if (!result.ok) {
    result.reachable = await probeHost(powersyncUrl);
    result.ok = result.reachable === true;
  }

  console.log("powersync-keepalive", JSON.stringify(result));

  return new Response(JSON.stringify(result), {
    status: result.ok ? 200 : 503,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
