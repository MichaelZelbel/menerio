import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

export interface HubAuthResult {
  userId: string;
  scopes: string[];
  keyId: string;
  /** The hub connection this key was made for, or null for a key made by hand. */
  connectionId: string | null;
}

/** Why a key was refused, for a caller that has to act on it rather than show it. */
export type HubKeyRefusal = "invalid" | "revoked" | "expired" | "connection_ended" | "unavailable";

export interface HubKeyLookup {
  /** The key's owner and scopes, or null when the key was refused. */
  result: HubAuthResult | null;
  /** Why the key was refused, in words a caller can show. Null when accepted. */
  errorMessage: string | null;
  /** The same reason as a fixed word. Null when accepted. */
  errorCode: HubKeyRefusal | null;
}

export const HUB_CONNECTION_ENDED_MESSAGE = "This hub's connection to Menerio was ended.";

const refused = (errorCode: HubKeyRefusal, errorMessage: string): HubKeyLookup =>
  ({ result: null, errorMessage, errorCode });

const LEGACY_KEY_COLUMNS = "id, user_id, scopes, is_active, expires_at";

// The admin client is only ever used for the hub_api_keys statements below (and
// one read of hub_connections for a connected hub's key), so callers may hand in
// one they already hold instead of us building a second.
// deno-lint-ignore no-explicit-any
type AdminClient = any;

async function sha256Hex(value: string): Promise<string> {
  const hashBuffer = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(hashBuffer)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Look up a Hub API key (mnr_...) from a bare string.
 *
 * Split out of authenticateHubKey because not every caller holds a whole
 * Request: the MCP connector accepts its key as a URL query parameter too,
 * since that is how ChatGPT's custom connectors send it.
 *
 * Pass `admin` to reuse a service-role client the caller already created.
 */
export async function lookupHubKey(
  apiKey: string,
  admin?: AdminClient
): Promise<HubKeyLookup> {
  const key = (apiKey ?? "").trim();

  if (!key.startsWith("mnr_")) {
    return refused("invalid", "Missing or invalid API key. Expected 'Bearer mnr_...' header.");
  }

  const keyHash = await sha256Hex(key);

  const supabaseAdmin = admin ?? createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  // Look up the key
  let { data: keyRow, error } = await supabaseAdmin
    .from("hub_api_keys")
    .select(`${LEGACY_KEY_COLUMNS}, hub_connection_id, generation`)
    .eq("key_hash", keyHash)
    .maybeSingle();

  // 42703 is "no such column": this code reached a database that does not have
  // the hub connection columns yet. Without them no key can belong to a
  // connection, so every key is read the way it always was. Answering "Invalid
  // API key." here instead would lock out every hub and every MCP client for as
  // long as the function and the migration are out of step.
  if (error?.code === "42703") {
    ({ data: keyRow, error } = await supabaseAdmin
      .from("hub_api_keys")
      .select(LEGACY_KEY_COLUMNS)
      .eq("key_hash", keyHash)
      .maybeSingle());
  }

  if (error || !keyRow) {
    return refused("invalid", "Invalid API key.");
  }

  // A key made by connecting a hub lives and dies with that connection. Its
  // owner sees one thing in Settings, the connected hub, so that is what every
  // refusal names, whichever of the checks below caught it.
  const connectionId: string | null = keyRow.hub_connection_id ?? null;

  if (!keyRow.is_active) {
    return connectionId
      ? refused("connection_ended", HUB_CONNECTION_ENDED_MESSAGE)
      : refused("revoked", "API key has been revoked.");
  }

  if (keyRow.expires_at && new Date(keyRow.expires_at) < new Date()) {
    return refused("expired", "API key has expired.");
  }

  if (connectionId) {
    // Accepted only while the connection is active AND this key is of its
    // current generation. Disconnecting, or connecting the same hub again,
    // also switches the older keys off; this check is what makes that hold
    // for a device that still carries the old value, on its very next request,
    // even if such a key were ever switched back on. The user_id filter means
    // a key can never borrow another account's connection.
    const { data: connection, error: connectionError } = await supabaseAdmin
      .from("hub_connections")
      .select("status, generation")
      .eq("id", connectionId)
      .eq("user_id", keyRow.user_id)
      .maybeSingle();

    if (connectionError) {
      // Not "ended": a hub told its connection was ended takes its setup apart,
      // and a database hiccup is no reason for that.
      return refused("unavailable", "Could not check this hub's connection right now. Try again in a moment.");
    }
    if (!connection || connection.status !== "active" || connection.generation !== keyRow.generation) {
      return refused("connection_ended", HUB_CONNECTION_ENDED_MESSAGE);
    }
  }

  // Update last_used_at (fire-and-forget)
  supabaseAdmin
    .from("hub_api_keys")
    .update({ last_used_at: new Date().toISOString() })
    .eq("id", keyRow.id)
    .then(() => {});

  return {
    result: {
      userId: keyRow.user_id,
      scopes: keyRow.scopes || [],
      keyId: keyRow.id,
      connectionId,
    },
    errorMessage: null,
    errorCode: null,
  };
}

/**
 * Authenticate a request using a Hub API key (mnr_...).
 * Returns the user_id, scopes, and key ID if valid.
 */
export async function authenticateHubKey(
  req: Request
): Promise<{ result: HubAuthResult | null; error: Response | null }> {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer mnr_")) {
    return {
      result: null,
      error: new Response(
        JSON.stringify({ error: "Missing or invalid API key. Expected 'Bearer mnr_...' header." }),
        { status: 401, headers: { "Content-Type": "application/json" } }
      ),
    };
  }

  const { result, errorMessage, errorCode } = await lookupHubKey(authHeader.replace("Bearer ", ""));

  if (!result) {
    return {
      result: null,
      error: new Response(
        JSON.stringify({ error: errorMessage ?? "Invalid API key." }),
        // 503 only for a connected hub's key whose connection could not be read;
        // every refusal a key could get before connections existed is still 401.
        { status: errorCode === "unavailable" ? 503 : 401, headers: { "Content-Type": "application/json" } }
      ),
    };
  }

  return { result, error: null };
}

/**
 * Returns a 403 Response if the given scope is not in the key's scopes array.
 */
export function requireScope(
  scopes: string[],
  required: string
): Response | null {
  if (!scopes.includes(required)) {
    return new Response(
      JSON.stringify({
        error: `Insufficient permissions. This key requires the '${required}' scope.`,
      }),
      { status: 403, headers: { "Content-Type": "application/json" } }
    );
  }
  return null;
}
