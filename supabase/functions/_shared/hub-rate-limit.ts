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
  const windowStartMs = Math.floor(now.getTime() / WINDOW_MS) * WINDOW_MS;
  const windowStart = new Date(windowStartMs).toISOString();

  const rateLimited = () => {
    const retryAfter = Math.ceil((windowStartMs + WINDOW_MS - now.getTime()) / 1000);
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

  // One statement counts the request and decides, inside the database.
  //
  // This used to be SELECT the count, compare it, then UPSERT the absolute value
  // count + 1. Sequentially that is correct, which is why it read as fine. In
  // parallel it is not a throttle at all: every caller in a burst reads the same
  // count and writes the same count + 1, so the stored counter advances by ONE
  // for the whole burst and every request is admitted. Measured against a limit
  // of 5, forty concurrent calls all passed and the counter finished at 1 — and
  // parallel traffic is the only kind a throttle exists to stop.
  //
  // `hub_api_bump_usage` does the increment relative to the stored value in a
  // single INSERT ... ON CONFLICT DO UPDATE, so Postgres serialises conflicting
  // writers on the unique index and each caller is told its own count.
  // `scripts/test-hub-rate-limit.mjs` runs both versions against real concurrent
  // connections so the difference stays proven.
  const { data, error } = await supabaseAdmin.rpc("hub_api_bump_usage", {
    p_key_id: keyId,
    p_window_start: windowStart,
    p_limit: RATE_LIMIT,
  });

  if (error) {
    // Fail OPEN, deliberately, and say so in the log.
    //
    // This throttle exists to stop abuse, not to protect data: every caller has
    // already proven it holds a valid key, and the endpoints behind it enforce
    // their own scopes and row-level security. A database hiccup here should not
    // take the whole Hub API offline for legitimate clients. The counter is the
    // thing that broke, so the honest response is to serve the request and make
    // the fault loud rather than silent.
    console.error(
      `[hub-rate-limit] usage counter unavailable for key=${keyId}: ` +
        `${[error.code, error.message].filter(Boolean).join(" ")}. Request allowed uncounted.`
    );
    return { allowed: true };
  }

  // The RPC returns a one-row table, which supabase-js surfaces as an array.
  const row = Array.isArray(data) ? data[0] : data;
  if (row && row.allowed === false) return rateLimited();

  return { allowed: true };
}
