import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "https://esm.sh/@supabase/supabase-js@2/cors";

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

  const token = authHeader.replace("Bearer ", "");
  const { data: claimsData, error: claimsError } = await supabase.auth.getClaims(token);
  if (claimsError || !claimsData?.claims) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers });
  }
  const userId = claimsData.claims.sub as string;

  const supabaseAdmin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  const url = new URL(req.url);
  const pathParts = url.pathname.split("/").filter(Boolean);
  // pathParts: ["hub-api-keys"] or ["hub-api-keys", "<id>"] or ["hub-api-keys", "generate"]
  const action = pathParts[1] || "";

  try {
    // POST /hub-api-keys/generate — Generate a new API key
    if (req.method === "POST" && action === "generate") {
      const body = await req.json();
      const { name, scopes } = body;

      if (!name || typeof name !== "string" || name.trim().length === 0) {
        return new Response(JSON.stringify({ error: "name is required" }), { status: 400, headers });
      }

      const validScopes = ["profile", "notes", "contacts", "actions", "graph", "media", "stats"];
      if (!Array.isArray(scopes) || scopes.length === 0 || !scopes.every((s: string) => validScopes.includes(s))) {
        return new Response(
          JSON.stringify({ error: `scopes must be a non-empty array of: ${validScopes.join(", ")}` }),
          { status: 400, headers }
        );
      }

      // Generate random key: mnr_ + 48 hex chars
      const randomBytes = new Uint8Array(24);
      crypto.getRandomValues(randomBytes);
      const hexKey = Array.from(randomBytes).map((b) => b.toString(16).padStart(2, "0")).join("");
      const fullKey = `mnr_${hexKey}`;
      const keyPrefix = fullKey.slice(0, 12);

      // Hash the key
      const encoder = new TextEncoder();
      const hashBuffer = await crypto.subtle.digest("SHA-256", encoder.encode(fullKey));
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      const keyHash = hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");

      const { data: inserted, error: insertError } = await supabaseAdmin
        .from("hub_api_keys")
        .insert({
          user_id: userId,
          key_hash: keyHash,
          key_prefix: keyPrefix,
          name: name.trim(),
          scopes,
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

    // GET /hub-api-keys — List all keys
    if (req.method === "GET" && !action) {
      const { data: keys, error } = await supabaseAdmin
        .from("hub_api_keys")
        .select("id, name, key_prefix, scopes, last_used_at, is_active, created_at, expires_at")
        .eq("user_id", userId)
        .order("created_at", { ascending: false });

      if (error) {
        return new Response(JSON.stringify({ error: error.message }), { status: 500, headers });
      }

      return new Response(JSON.stringify({ keys }), { status: 200, headers });
    }

    // DELETE /hub-api-keys/<id> — Revoke a key
    if (req.method === "DELETE" && action) {
      const { error } = await supabaseAdmin
        .from("hub_api_keys")
        .update({ is_active: false })
        .eq("id", action)
        .eq("user_id", userId);

      if (error) {
        return new Response(JSON.stringify({ error: error.message }), { status: 500, headers });
      }

      return new Response(JSON.stringify({ success: true }), { status: 200, headers });
    }

    // PATCH /hub-api-keys/<id> — Update name or scopes
    if (req.method === "PATCH" && action) {
      const body = await req.json();
      const updates: Record<string, unknown> = {};

      if (body.name && typeof body.name === "string") {
        updates.name = body.name.trim();
      }

      const validScopes = ["profile", "notes", "contacts", "actions", "graph", "media", "stats"];
      if (Array.isArray(body.scopes) && body.scopes.length > 0 && body.scopes.every((s: string) => validScopes.includes(s))) {
        updates.scopes = body.scopes;
      }

      if (Object.keys(updates).length === 0) {
        return new Response(JSON.stringify({ error: "No valid fields to update" }), { status: 400, headers });
      }

      const { data: updated, error } = await supabaseAdmin
        .from("hub_api_keys")
        .update(updates)
        .eq("id", action)
        .eq("user_id", userId)
        .select("id, name, key_prefix, scopes, is_active")
        .single();

      if (error) {
        return new Response(JSON.stringify({ error: error.message }), { status: 500, headers });
      }

      return new Response(JSON.stringify(updated), { status: 200, headers });
    }

    return new Response(JSON.stringify({ error: "Not found" }), { status: 404, headers });
  } catch (err) {
    return new Response(JSON.stringify({ error: (err as Error).message }), { status: 500, headers });
  }
});
