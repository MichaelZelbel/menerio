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

  const rateLimited = () => {
    const windowEnd =
      Math.floor(now.getTime() / WINDOW_MS) * WINDOW_MS + WINDOW_MS;
    const retryAfter = Math.ceil((windowEnd - now.getTime()) / 1000);
    return {
      allowed: false as const,
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
  };

  // Read the current count for this window, decide, then increment.
  // NOTE: the previous implementation upserted `request_count: 1` on every
  // call, which reset the counter to 1 each request via ON CONFLICT DO UPDATE —
  // so the limit was NEVER reached and every key was effectively unlimited.
  // Here we read the real count and only bump it. There is a small benign race
  // under highly concurrent bursts (two callers can both read N and write N+1,
  // undercounting slightly); that is acceptable for an abuse throttle and is
  // vastly better than the permanent bypass. A fully atomic version would use a
  // DB-side `INSERT ... ON CONFLICT DO UPDATE SET request_count = request_count + 1`
  // function once the table's column types are confirmed.
  const { data: existing } = await supabaseAdmin
    .from("hub_api_usage")
    .select("request_count")
    .eq("key_id", keyId)
    .eq("window_start", windowStart)
    .maybeSingle();

  const currentCount = existing?.request_count ?? 0;
  if (currentCount >= RATE_LIMIT) {
    return rateLimited();
  }

  await supabaseAdmin
    .from("hub_api_usage")
    .upsert(
      { key_id: keyId, window_start: windowStart, request_count: currentCount + 1 },
      { onConflict: "key_id,window_start", ignoreDuplicates: false }
    );

  return { allowed: true };
}
