import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { lookupHubKey } from "../_shared/hub-auth.ts";
import { checkRateLimit } from "../_shared/hub-rate-limit.ts";
import { mintHubKey } from "../_shared/hub-key-mint.ts";
import { sha256Hex } from "../_shared/sha256.ts";
import { corsHeaders, handleOptions, parsePath } from "../_shared/hub-helpers.ts";
import {
  DEFAULT_APP_URL,
  HUB_CONNECT_ERRORS,
  HUB_CONNECT_LIMITS,
  HUB_GRANT_SCOPES,
  type HubConnectErrorCode,
  type RequestStatus,
  callerAddress,
  computeS256Challenge,
  generateUserCode,
  hashCallerAddress,
  isCodeVerifier,
  isUuid,
  normalizeUserCode,
  parseContactHeaders,
  parseStartRequest,
  tokenErrorForStatus,
  verificationUris,
} from "../_shared/hub-connect-protocol.ts";

/**
 * Connect a hub to Menerio without anyone typing a key.
 *
 *   POST /start       the hub asks                     no authorization
 *   GET  /request     the approval page reads it       the person's session
 *   POST /approve     the person says yes or no        the person's session
 *   POST /token       the hub collects its key, once   the verifier is the proof
 *   GET  /status      a device reports in              Bearer mnr_...
 *   POST /disconnect  end the connection               Bearer mnr_... or the session
 *
 * What is allowed when is decided in _shared/hub-connect-protocol.ts and, for
 * anything that changes more than one row, inside the hub_connect_* SQL
 * functions, each of which is one transaction. This file only reads the
 * request, asks them, and words the answer.
 *
 * The key exists in this process for the length of one /token call. It is
 * stored as a hash, returned once, and never logged.
 */

// The new tables are not in any generated types, and lookupHubKey takes the
// client untyped for the same reason.
// deno-lint-ignore no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AdminClient = any;

/** Every answer of this function: never cached, by a browser or anything between. */
function json(body: unknown, status = 200, extra?: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": "no-store", ...extra },
  });
}

function fail(code: HubConnectErrorCode, message?: string, extra?: Record<string, string>): Response {
  const known = HUB_CONNECT_ERRORS[code];
  return json({ error: code, message: message ?? known.message }, known.status, extra);
}

async function readBody(req: Request): Promise<Record<string, unknown> | null> {
  try {
    const parsed = await req.json();
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/** The signed-in person behind a Supabase session token, or null. */
async function sessionUser(req: Request): Promise<{ id: string; email: string | null } | null> {
  const authHeader = req.headers.get("Authorization");
  // A hub key is not a session; asking the auth server about it would only log noise.
  if (!authHeader?.startsWith("Bearer ") || authHeader.startsWith("Bearer mnr_")) return null;
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: authHeader } } },
  );
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return null;
  return { id: user.id, email: user.email ?? null };
}

/**
 * How the account is named to the person and to the hub: its email address,
 * the one thing that tells two accounts of the same person apart.
 */
async function accountLabel(admin: AdminClient, userId: string): Promise<string> {
  try {
    const { data } = await admin.auth.admin.getUserById(userId);
    return data?.user?.email ?? "Menerio account";
  } catch {
    return "Menerio account";
  }
}

function logDbError(route: string, error: { code?: string; message?: string }) {
  console.error(`[hub-connect] ${route}: ${[error.code, error.message].filter(Boolean).join(" ")}`);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return handleOptions();

  const url = new URL(req.url);
  // parts[0] = "hub-connect", parts[1] = route
  const route = parsePath(url)[1] || "";

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  try {
    // ── POST /start ─────────────────────────────────────────────────────────
    if (route === "start") {
      if (req.method !== "POST") return fail("method_not_allowed");
      const body = await readBody(req);
      if (!body) return fail("invalid_request", "The body must be a JSON object.");
      const { request, problem } = parseStartRequest(body);
      if (!request) return fail("invalid_request", problem);

      // Keyed with the service key so the stored value cannot be turned back
      // into an address by trying every address there is.
      const callerHash = await hashCallerAddress(
        callerAddress((name) => req.headers.get(name)),
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      );

      const { data, error } = await admin.rpc("hub_connect_start", {
        p_hub_id: request.hubId,
        p_hub_name: request.hubName,
        p_device_id: request.deviceId,
        p_device_name: request.deviceName,
        p_flow: request.flow,
        p_wants: request.wants,
        p_code_challenge: request.codeChallenge,
        p_user_code: generateUserCode((count) => crypto.getRandomValues(new Uint8Array(count))),
        p_caller_hash: callerHash,
        p_ttl_seconds: HUB_CONNECT_LIMITS.requestTtlSeconds,
        p_max_starts_per_hour: HUB_CONNECT_LIMITS.startsPerHour,
      });
      if (error) {
        logDbError("start", error);
        return fail("server_error");
      }
      if (!data?.allowed) {
        return fail("slow_down", "Too many connection requests from this address. Try again in an hour.", { "Retry-After": "3600" });
      }

      const appUrl = Deno.env.get("HUB_CONNECT_APP_URL") || DEFAULT_APP_URL;
      return json({
        request_id: data.request_id,
        user_code: data.user_code,
        ...verificationUris(appUrl, data.request_id, data.user_code),
        expires_in: HUB_CONNECT_LIMITS.requestTtlSeconds,
        interval: HUB_CONNECT_LIMITS.pollIntervalSeconds,
      });
    }

    // ── GET /request ────────────────────────────────────────────────────────
    if (route === "request") {
      if (req.method !== "GET") return fail("method_not_allowed");
      const user = await sessionUser(req);
      if (!user) return fail("unauthorized");
      const requestId = url.searchParams.get("request_id");
      if (!isUuid(requestId)) return fail("not_found");

      const { data, error } = await admin.rpc("hub_connect_view", {
        p_request_id: requestId,
        p_user_id: user.id,
      });
      if (error) {
        logDbError("request", error);
        return fail("server_error");
      }
      if (!data) return fail("not_found");
      return json({ ...data, account_label: user.email ?? "Menerio account" });
    }

    // ── POST /approve ───────────────────────────────────────────────────────
    if (route === "approve") {
      if (req.method !== "POST") return fail("method_not_allowed");
      const user = await sessionUser(req);
      if (!user) return fail("unauthorized");
      const body = await readBody(req);
      if (!body) return fail("invalid_request", "The body must be a JSON object.");
      if (!isUuid(body.request_id)) return fail("not_found");
      if (typeof body.approve !== "boolean") return fail("invalid_request", "approve must be true or false.");

      const { data, error } = await admin.rpc("hub_connect_decide", {
        p_request_id: body.request_id,
        p_user_id: user.id,
        // A code that cannot be a code is still an attempt, so it goes in as
        // null and is counted, rather than being turned away for free here.
        p_user_code: normalizeUserCode(body.user_code),
        p_approve: body.approve,
        p_documents: body.documents === true,
        p_max_wrong_codes: HUB_CONNECT_LIMITS.maxWrongCodes,
      });
      if (error) {
        logDbError("approve", error);
        return fail("server_error");
      }
      switch (data?.outcome) {
        case "approved": return json({ status: "approved" });
        case "denied": return json({ status: "denied" });
        case "wrong_code": return json({
          error: "wrong_code",
          message: HUB_CONNECT_ERRORS.wrong_code.message,
          attempts_left: data.attempts_left,
        }, HUB_CONNECT_ERRORS.wrong_code.status);
        default: return fail("not_found");
      }
    }

    // ── POST /token ─────────────────────────────────────────────────────────
    if (route === "token") {
      if (req.method !== "POST") return fail("method_not_allowed");
      const body = await readBody(req);
      if (!body) return fail("invalid_request", "The body must be a JSON object.");
      if (!isUuid(body.request_id)) return fail("invalid_request", "request_id must be a UUID.");

      // A verifier of the wrong shape is a wrong verifier: it is sent on as "no
      // challenge" so the database counts it like any other miss.
      const computedChallenge = isCodeVerifier(body.code_verifier)
        ? await computeS256Challenge(body.code_verifier)
        : null;

      // Minted before the database is asked, because handing it over and
      // storing its hash have to be one transaction. For every poll that is not
      // the collecting one the key is dropped here, unstored and unseen.
      const minted = await mintHubKey();

      const { data, error } = await admin.rpc("hub_connect_collect", {
        p_request_id: body.request_id,
        p_computed_challenge: computedChallenge,
        p_device_id: isUuid(body.device_id) ? body.device_id.toLowerCase() : null,
        p_key_hash: minted.keyHash,
        p_key_prefix: minted.keyPrefix,
        p_scopes: [...HUB_GRANT_SCOPES],
        p_min_poll_gap_ms: HUB_CONNECT_LIMITS.minPollGapMs,
        p_max_wrong_verifiers: HUB_CONNECT_LIMITS.maxWrongVerifiers,
      });
      if (error) {
        logDbError("token", error);
        return fail("server_error");
      }

      switch (data?.outcome) {
        case "slow_down":
          return fail("slow_down", undefined, { "Retry-After": String(HUB_CONNECT_LIMITS.pollIntervalSeconds) });
        case "invalid_grant":
          return fail("invalid_grant");
        case "not_collectable":
          return fail(tokenErrorForStatus(data.status as RequestStatus) ?? "expired_token");
        case "collected":
          return json({
            api_key: minted.fullKey, // the only time it leaves this function
            connection_id: data.connection_id,
            hub_id: data.hub_id,
            generation: data.generation,
            account_label: await accountLabel(admin, data.user_id),
            scopes: data.scopes,
            documents: data.documents,
          });
        default:
          return fail("server_error");
      }
    }

    // ── GET /status ─────────────────────────────────────────────────────────
    if (route === "status") {
      if (req.method !== "GET") return fail("method_not_allowed");
      const key = await hubKey(req, admin);
      if (key.error) return key.error;
      const auth = key.auth;

      const rl = await checkRateLimit(auth.keyId);
      if (!rl.allowed) return fail("slow_down", undefined, { "Retry-After": String(rl.retryAfter ?? 60) });

      // A key made by hand, which is every key older than this flow. It works
      // as it always did; the hub is only told it is not a connection.
      if (!auth.connectionId) {
        return json({ connected: true, legacy_key: true, scopes: auth.scopes });
      }

      const contact = parseContactHeaders((name) => req.headers.get(name));
      const { data, error } = await admin.rpc("hub_connect_touch", {
        p_key_id: auth.keyId,
        p_device_id: contact.deviceId,
        p_device_name: contact.deviceName,
        p_client: contact.client,
        p_client_state: contact.clientState,
      });
      if (error) {
        logDbError("status", error);
        return fail("server_error");
      }
      // Ended between the key check and this call.
      if (!data) return fail("revoked");

      return json({
        connected: true,
        connection_id: data.connection_id,
        hub_id: data.hub_id,
        hub_name: data.hub_name,
        generation: data.generation,
        account_label: await accountLabel(admin, data.user_id),
        scopes: auth.scopes,
        documents: data.documents,
        devices: data.devices,
      });
    }

    // ── POST /disconnect ────────────────────────────────────────────────────
    if (route === "disconnect") {
      if (req.method !== "POST") return fail("method_not_allowed");
      const authHeader = req.headers.get("Authorization") ?? "";

      // From the hub: the key names the connection, nothing in the body does.
      if (authHeader.startsWith("Bearer mnr_")) {
        const key = await hubKey(req, admin);
        if (key.error) {
          // Ending twice has to answer the same as ending once, and the second
          // time the key is already dead. If what it belonged to is an ended
          // connection, the caller has what it asked for.
          if (key.code === "revoked" && await belongsToEndedConnection(admin, authHeader.slice("Bearer ".length))) {
            return json({ status: "disconnected" });
          }
          return key.error;
        }
        const { data, error } = await admin.rpc("hub_connect_disconnect", {
          p_user_id: null,
          p_connection_id: null,
          p_key_id: key.auth.keyId,
        });
        if (error) {
          logDbError("disconnect", error);
          return fail("server_error");
        }
        if (data === "disconnected") return json({ status: "disconnected" });
        if (data === "legacy_key") return fail("legacy_key");
        if (data === "revoked") return fail("revoked");
        return fail("invalid_key");
      }

      // From Settings: the session says who, the body says which connection,
      // and the database checks that the one belongs to the other.
      const user = await sessionUser(req);
      if (!user) return fail("unauthorized");
      const body = await readBody(req);
      if (!body) return fail("invalid_request", "The body must be a JSON object.");
      if (!isUuid(body.connection_id)) return fail("not_found", "No such connection.");

      const { data, error } = await admin.rpc("hub_connect_disconnect", {
        p_user_id: user.id,
        p_connection_id: body.connection_id,
        p_key_id: null,
      });
      if (error) {
        logDbError("disconnect", error);
        return fail("server_error");
      }
      if (data === "disconnected") return json({ status: "disconnected" });
      return fail("not_found", "No such connection.");
    }

    return fail("not_found", "No such route.");
  } catch (err) {
    console.error(`[hub-connect] ${route || "?"}: ${(err as Error).message}`);
    return fail("server_error");
  }
});

type HubKeyCheck =
  | { auth: { userId: string; scopes: string[]; keyId: string; connectionId: string | null }; error: null; code: null }
  | { auth: null; error: Response; code: HubConnectErrorCode };

/**
 * The `Bearer mnr_...` key of a request, through the same lookup every Hub API
 * function uses, with the refusal worded the way this function words errors.
 */
async function hubKey(req: Request, admin: AdminClient): Promise<HubKeyCheck> {
  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.startsWith("Bearer mnr_")) {
    return { auth: null, error: fail("invalid_key", "Send the hub's key as 'Authorization: Bearer mnr_...'."), code: "invalid_key" };
  }
  const { result, errorCode, errorMessage } = await lookupHubKey(authHeader.slice("Bearer ".length), admin);
  if (result) return { auth: result, error: null, code: null };
  const code: HubConnectErrorCode =
    errorCode === "connection_ended" || errorCode === "revoked" ? "revoked"
    : errorCode === "unavailable" ? "unavailable"
    : "invalid_key";
  // The lookup's own sentence: it knows whether a key expired, was revoked by
  // hand, or lost its connection.
  return { auth: null, error: fail(code, errorMessage ?? undefined), code };
}

/** True when this key was minted for a connection that has since been ended. */
async function belongsToEndedConnection(admin: AdminClient, apiKey: string): Promise<boolean> {
  const { data: keyRow } = await admin
    .from("hub_api_keys")
    .select("user_id, hub_connection_id")
    .eq("key_hash", await sha256Hex(apiKey.trim()))
    .maybeSingle();
  if (!keyRow?.hub_connection_id) return false;
  const { data: connection } = await admin
    .from("hub_connections")
    .select("status")
    .eq("id", keyRow.hub_connection_id)
    .eq("user_id", keyRow.user_id)
    .maybeSingle();
  return connection?.status === "revoked";
}
