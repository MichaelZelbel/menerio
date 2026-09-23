import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { mintGodspeedKey } from "../_shared/mc-key-mint.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const VALID_SCOPES = ["profile", "notes", "contacts", "actions", "graph", "media", "stats", "world", "lexicon", "collections"];

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The JSON body as an object, or null when it is malformed or not an object. */
async function readBody(req: Request): Promise<Record<string, unknown> | null> {
  try {
    const parsed = await req.json();
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const headers = { ...corsHeaders, "Content-Type": "application/json" };

  // Authenticate via Supabase session (user must be logged into Menerio)
  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: authHeader } } }
  );

  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError || !user) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers });
  }
  const userId = user.id;

  const supabaseAdmin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  const url = new URL(req.url);
  const pathParts = url.pathname.split("/").filter(Boolean);
  // pathParts: ["mc-api-keys"] or ["mc-api-keys", "<id>"] or ["mc-api-keys", "generate"]
  const action = pathParts[1] || "";

  try {
    // POST /mc-api-keys/generate — Generate a new API key
    if (req.method === "POST" && action === "generate") {
      const body = await readBody(req);
      if (!body) return new Response(JSON.stringify({ error: "Request body must be a JSON object" }), { status: 400, headers });
      const { name, scopes } = body;

      if (!name || typeof name !== "string" || name.trim().length === 0) {
        return new Response(JSON.stringify({ error: "name is required" }), { status: 400, headers });
      }

      // "godspeed" is the retired connector scope: every key connects now, so an old
      // client still sending it gets it silently dropped rather than an error.
      const validScopes = VALID_SCOPES;
      const requestedScopes = Array.isArray(scopes) ? scopes.filter((s: string) => s !== "godspeed") : scopes;
      if (!Array.isArray(requestedScopes) || requestedScopes.length === 0 || !requestedScopes.every((s: string) => validScopes.includes(s))) {
        return new Response(
          JSON.stringify({ error: `scopes must be a non-empty array of: ${validScopes.join(", ")}` }),
          { status: 400, headers }
        );
      }

      // mnr_ + 48 hex chars, stored only as a hash. Shared with mc-connect so
      // there is one way to make a key.
      const { fullKey, keyPrefix, keyHash } = await mintGodspeedKey();

      const { data: inserted, error: insertError } = await supabaseAdmin
        .from("godspeed_api_keys")
        .insert({
          user_id: userId,
          key_hash: keyHash,
          key_prefix: keyPrefix,
          name: name.trim(),
          scopes: requestedScopes,
        })
        .select("id, name, key_prefix, scopes, created_at")
        .single();

      if (insertError) {
        return new Response(JSON.stringify({ error: insertError.message }), { status: 500, headers });
      }

      return new Response(
        JSON.stringify({
          ...inserted,
          api_key: fullKey, // Only returned once!
          warning: "Copy this key now — you won't be able to see it again.",
        }),
        { status: 201, headers }
      );
    }

    // GET /mc-api-keys — List all keys
    if (req.method === "GET" && !action) {
      const { data: keys, error } = await supabaseAdmin
        .from("godspeed_api_keys")
        .select("id, name, key_prefix, scopes, last_used_at, is_active, created_at, expires_at")
        .eq("user_id", userId)
        .order("created_at", { ascending: false });

      if (error) {
        return new Response(JSON.stringify({ error: error.message }), { status: 500, headers });
      }

      return new Response(JSON.stringify({ keys }), { status: 200, headers });
    }

    // DELETE /mc-api-keys/<id> — Revoke a key
    if (req.method === "DELETE" && action) {
      if (!UUID_PATTERN.test(action)) {
        return new Response(JSON.stringify({ error: "Key not found" }), { status: 404, headers });
      }
      // Revoking an id that is not one of this user's keys used to answer
      // success, so a client revoking the wrong id believed a leaked key was
      // dead while it kept working.
      const { data: revoked, error } = await supabaseAdmin
        .from("godspeed_api_keys")
        .update({ is_active: false })
        .eq("id", action)
        .eq("user_id", userId)
        .select("id")
        .maybeSingle();

      if (error) {
        return new Response(JSON.stringify({ error: error.message }), { status: 500, headers });
      }
      if (!revoked) {
        return new Response(JSON.stringify({ error: "Key not found" }), { status: 404, headers });
      }

      return new Response(JSON.stringify({ success: true }), { status: 200, headers });
    }

    // PATCH /mc-api-keys/<id> — Update name or scopes
    if (req.method === "PATCH" && action) {
      if (!UUID_PATTERN.test(action)) {
        return new Response(JSON.stringify({ error: "Key not found" }), { status: 404, headers });
      }
      const body = await readBody(req);
      if (!body) return new Response(JSON.stringify({ error: "Request body must be a JSON object" }), { status: 400, headers });
      const updates: Record<string, unknown> = {};

      if (typeof body.name === "string" && body.name.trim().length > 0) {
        updates.name = body.name.trim();
      }

      // Invalid scopes used to be dropped without a word: a PATCH carrying a
      // new name and a misspelt scope answered 200 with the old scopes kept,
      // so the caller believed the key's access had changed when it had not.
      if (body.scopes !== undefined) {
        const patchScopes = Array.isArray(body.scopes) ? body.scopes.filter((s: unknown) => s !== "godspeed") : body.scopes;
        if (!Array.isArray(patchScopes) || patchScopes.length === 0 || !patchScopes.every((s: unknown) => typeof s === "string" && VALID_SCOPES.includes(s))) {
          return new Response(
            JSON.stringify({ error: `scopes must be a non-empty array of: ${VALID_SCOPES.join(", ")}` }),
            { status: 400, headers }
          );
        }
        updates.scopes = patchScopes;
      }

      if (Object.keys(updates).length === 0) {
        return new Response(JSON.stringify({ error: "No valid fields to update" }), { status: 400, headers });
      }

      const { data: updated, error } = await supabaseAdmin
        .from("godspeed_api_keys")
        .update(updates)
        .eq("id", action)
        .eq("user_id", userId)
        .select("id, name, key_prefix, scopes, is_active")
        .maybeSingle();

      if (error) {
        return new Response(JSON.stringify({ error: error.message }), { status: 500, headers });
      }
      if (!updated) {
        return new Response(JSON.stringify({ error: "Key not found" }), { status: 404, headers });
      }

      return new Response(JSON.stringify(updated), { status: 200, headers });
    }

    return new Response(JSON.stringify({ error: "Not found" }), { status: 404, headers });
  } catch (err) {
    return new Response(JSON.stringify({ error: (err as Error).message }), { status: 500, headers });
  }
});
