import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const RATE_LIMIT = 1000; // requests per hour

/**
 * Check and increment the rate limit for a given API key.
 * Returns null if allowed, or a 429 Response if rate limited.
 */
export async function checkRateLimit(keyId: string): Promise<Response | null> {
  const supabaseAdmin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  // Truncate to the current hour
  const now = new Date();
  const windowStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours()).toISOString();

  // Upsert: increment if exists, insert with 1 if not
  const { data, error } = await supabaseAdmin.rpc("increment_hub_api_usage", {
    p_key_id: keyId,
    p_window_start: windowStart,
  });

  // Fallback if RPC doesn't exist yet — use raw upsert
  if (error) {
    // Try direct upsert
    const { data: existing } = await supabaseAdmin
      .from("hub_api_usage")
      .select("request_count")
      .eq("key_id", keyId)
      .eq("window_start", windowStart)
      .single();

    if (existing) {
      if (existing.request_count >= RATE_LIMIT) {
        const retryAfter = 3600 - (now.getMinutes() * 60 + now.getSeconds());
        return new Response(
          JSON.stringify({ error: "Rate limit exceeded. Max 1000 requests per hour." }),
          {
            status: 429,
            headers: {
              "Content-Type": "application/json",
              "Retry-After": String(retryAfter),
            },
          }
        );
      }
      await supabaseAdmin
        .from("hub_api_usage")
        .update({ request_count: existing.request_count + 1 })
        .eq("key_id", keyId)
        .eq("window_start", windowStart);
    } else {
      await supabaseAdmin
        .from("hub_api_usage")
        .insert({ key_id: keyId, window_start: windowStart, request_count: 1 });
    }
    return null;
  }

  // RPC returned the new count
  if (typeof data === "number" && data > RATE_LIMIT) {
    const retryAfter = 3600 - (now.getMinutes() * 60 + now.getSeconds());
    return new Response(
      JSON.stringify({ error: "Rate limit exceeded. Max 1000 requests per hour." }),
      {
        status: 429,
        headers: {
          "Content-Type": "application/json",
          "Retry-After": String(retryAfter),
        },
      }
    );
  }

  return null;
}
