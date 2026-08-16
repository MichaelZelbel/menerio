import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

export interface HubAuthResult {
  userId: string;
  scopes: string[];
  keyId: string;
}

export interface HubKeyLookup {
  /** The key's owner and scopes, or null when the key was refused. */
  result: HubAuthResult | null;
  /** Why the key was refused, in words a caller can show. Null when accepted. */
  errorMessage: string | null;
}

// The admin client is only ever used for the two hub_api_keys statements below,
// so callers may hand in one they already hold instead of us building a second.
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
    return {
      result: null,
      errorMessage: "Missing or invalid API key. Expected 'Bearer mnr_...' header.",
    };
  }

  const keyHash = await sha256Hex(key);

  const supabaseAdmin = admin ?? createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  // Look up the key
  const { data: keyRow, error } = await supabaseAdmin
    .from("hub_api_keys")
    .select("id, user_id, scopes, is_active, expires_at")
    .eq("key_hash", keyHash)
    .maybeSingle();

  if (error || !keyRow) {
    return { result: null, errorMessage: "Invalid API key." };
  }

  if (!keyRow.is_active) {
    return { result: null, errorMessage: "API key has been revoked." };
  }

  if (keyRow.expires_at && new Date(keyRow.expires_at) < new Date()) {
    return { result: null, errorMessage: "API key has expired." };
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
    },
    errorMessage: null,
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

  const { result, errorMessage } = await lookupHubKey(authHeader.replace("Bearer ", ""));

  if (!result) {
    return {
      result: null,
      error: new Response(
        JSON.stringify({ error: errorMessage ?? "Invalid API key." }),
        { status: 401, headers: { "Content-Type": "application/json" } }
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
