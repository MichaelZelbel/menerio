import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

export interface HubAuthResult {
  userId: string;
  scopes: string[];
  keyId: string;
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

  const apiKey = authHeader.replace("Bearer ", "");

  // Hash the key with SHA-256
  const encoder = new TextEncoder();
  const data = encoder.encode(apiKey);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const keyHash = hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");

  const supabaseAdmin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  // Look up the key
  const { data: keyRow, error } = await supabaseAdmin
    .from("hub_api_keys")
    .select("id, user_id, scopes, is_active, expires_at")
    .eq("key_hash", keyHash)
    .single();

  if (error || !keyRow) {
    return {
      result: null,
      error: new Response(
        JSON.stringify({ error: "Invalid API key." }),
        { status: 401, headers: { "Content-Type": "application/json" } }
      ),
    };
  }

  if (!keyRow.is_active) {
    return {
      result: null,
      error: new Response(
        JSON.stringify({ error: "API key has been revoked." }),
        { status: 401, headers: { "Content-Type": "application/json" } }
      ),
    };
  }

  if (keyRow.expires_at && new Date(keyRow.expires_at) < new Date()) {
    return {
      result: null,
      error: new Response(
        JSON.stringify({ error: "API key has expired." }),
        { status: 401, headers: { "Content-Type": "application/json" } }
      ),
    };
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
    error: null,
  };
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
