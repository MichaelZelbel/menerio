import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const RATE_LIMIT = 1000; // requests per hour per key
const WINDOW_MS = 60 * 60 * 1000; // 1 hour

export async function checkRateLimit(
  keyId: string
): Promise<{ allowed: boolean; retryAfter?: number; error?: Response }> {
  const supabaseAdmin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  const now = new Date();
  const windowStart = new Date(
    Math.floor(now.getTime() / WINDOW_MS) * WINDOW_MS
  ).toISOString();

  // Upsert the usage row for this window
  const { data, error } = await supabaseAdmin
    .from("hub_api_usage")
    .upsert(
      { key_id: keyId, window_start: windowStart, request_count: 1 },
      { onConflict: "key_id,window_start", ignoreDuplicates: false }
    )
    .select("request_count")
    .single();

  if (error) {
    // If upsert failed, try increment
    const { data: existing } = await supabaseAdmin
      .from("hub_api_usage")
      .select("request_count")
      .eq("key_id", keyId)
      .eq("window_start", windowStart)
      .single();

    if (existing) {
      if (existing.request_count >= RATE_LIMIT) {
        const windowEnd =
          Math.floor(now.getTime() / WINDOW_MS) * WINDOW_MS + WINDOW_MS;
        const retryAfter = Math.ceil((windowEnd - now.getTime()) / 1000);
        return {
          allowed: false,
          retryAfter,
          error: new Response(
            JSON.stringify({
              error: {
                code: "RATE_LIMITED",
                message: `Rate limit exceeded. Max ${RATE_LIMIT} requests per hour.`,
              },
            }),
            {
              status: 429,
              headers: {
                "Content-Type": "application/json",
                "Retry-After": String(retryAfter),
              },
            }
          ),
        };
      }
      await supabaseAdmin.rpc("increment_hub_usage", {
        p_key_id: keyId,
        p_window_start: windowStart,
      }).catch(() => {
        // Fallback: just update directly
        supabaseAdmin
          .from("hub_api_usage")
          .update({ request_count: existing.request_count + 1 })
          .eq("key_id", keyId)
          .eq("window_start", windowStart)
          .then(() => {});
      });
    }
    return { allowed: true };
  }

  if (data && data.request_count > RATE_LIMIT) {
    const windowEnd =
      Math.floor(now.getTime() / WINDOW_MS) * WINDOW_MS + WINDOW_MS;
    const retryAfter = Math.ceil((windowEnd - now.getTime()) / 1000);
    return {
      allowed: false,
      retryAfter,
      error: new Response(
        JSON.stringify({
          error: {
            code: "RATE_LIMITED",
            message: `Rate limit exceeded. Max ${RATE_LIMIT} requests per hour.`,
          },
        }),
        {
          status: 429,
          headers: {
            "Content-Type": "application/json",
            "Retry-After": String(retryAfter),
          },
        }
      ),
    };
  }

  return { allowed: true };
}
