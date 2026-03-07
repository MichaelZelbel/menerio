import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

    // --- Auth ---
    const authHeader = req.headers.get("Authorization");
    let callerId: string | null = null;
    let isServiceRole = false;

    if (authHeader?.startsWith("Bearer ")) {
      const token = authHeader.replace("Bearer ", "");
      // Check if it's the service role key itself
      if (token === serviceRoleKey) {
        isServiceRole = true;
      } else {
        const authClient = createClient(supabaseUrl, anonKey, {
          global: { headers: { Authorization: authHeader } },
        });
        const { data, error } = await authClient.auth.getClaims(token);
        if (error || !data?.claims) {
          return json({ error: "Unauthorized" }, 401);
        }
        callerId = data.claims.sub as string;
      }
    } else {
      return json({ error: "Unauthorized" }, 401);
    }

    // Service-role client for all DB operations
    const db = createClient(supabaseUrl, serviceRoleKey);

    // --- Parse body ---
    let body: { user_id?: string; batch_init?: boolean } = {};
    try {
      body = await req.json();
    } catch {
      // empty body is fine
    }

    const targetUserId = body.user_id || callerId;
    const batchInit = body.batch_init === true;

    // --- Admin check helper ---
    async function requireAdmin() {
      if (isServiceRole) return;
      if (!callerId) return json({ error: "Unauthorized" }, 401);
      const { data } = await db.rpc("is_admin", { _user_id: callerId });
      if (!data) {
        return json({ error: "Forbidden: admin required" }, 403);
      }
      return null;
    }

    // --- Period dates (1st of current month → 1st of next month, UTC) ---
    function getPeriodDates() {
      const now = new Date();
      const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
      const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
      return { period_start: start.toISOString(), period_end: end.toISOString() };
    }

    // --- Fetch settings ---
    async function getSettings() {
      const { data, error } = await db
        .from("ai_credit_settings")
        .select("key, value_int");
      if (error) throw error;
      const map: Record<string, number> = {};
      for (const row of data!) map[row.key] = row.value_int;
      return map;
    }

    // --- Ensure allowance for a single user ---
    async function ensureForUser(userId: string) {
      const { period_start, period_end } = getPeriodDates();

      // Check existing period
      const { data: existing } = await db
        .from("ai_allowance_periods")
        .select("*")
        .eq("user_id", userId)
        .gte("period_end", new Date().toISOString())
        .lte("period_start", new Date().toISOString())
        .maybeSingle();

      if (existing) return existing;

      // Get user role
      const { data: roleData } = await db.rpc("get_user_role", { _user_id: userId });
      const role = roleData || "free";

      // Get settings
      const settings = await getSettings();
      const tokensPerCredit = settings["tokens_per_credit"] || 200;

      let creditsPerMonth = 0;
      if (role === "premium" || role === "premium_gift" || role === "admin") {
        creditsPerMonth = settings["credits_premium_per_month"] || 1500;
      } else {
        creditsPerMonth = settings["credits_free_per_month"] || 0;
      }

      const baseTokens = creditsPerMonth * tokensPerCredit;

      // Previous period rollover (unused tokens, capped at baseTokens)
      let rolloverTokens = 0;
      const prevEnd = period_start; // previous period ended when current starts
      const { data: prevPeriod } = await db
        .from("ai_allowance_periods")
        .select("tokens_granted, tokens_used")
        .eq("user_id", userId)
        .lt("period_end", prevEnd)
        .order("period_end", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (prevPeriod) {
        const unused = Math.max(0, prevPeriod.tokens_granted - prevPeriod.tokens_used);
        rolloverTokens = Math.min(unused, baseTokens);
      }

      const tokensGranted = baseTokens + rolloverTokens;

      const source = role === "free" ? "free_tier" : "role_based";

      const { data: inserted, error: insertErr } = await db
        .from("ai_allowance_periods")
        .insert({
          user_id: userId,
          tokens_granted: tokensGranted,
          tokens_used: 0,
          period_start,
          period_end,
          source,
          metadata: {
            base_tokens: baseTokens,
            rollover_tokens: rolloverTokens,
            credits_per_month: creditsPerMonth,
            tokens_per_credit: tokensPerCredit,
            role,
          },
        })
        .select()
        .single();

      if (insertErr) throw insertErr;
      return inserted;
    }

    // --- Batch init ---
    if (batchInit) {
      const denied = await requireAdmin();
      if (denied) return denied;

      const { data: profiles, error: pErr } = await db
        .from("profiles")
        .select("id");
      if (pErr) throw pErr;

      let initialized = 0;
      for (const profile of profiles!) {
        const result = await ensureForUser(profile.id);
        // If we just created it (no pre-existing), count it
        if (result) initialized++;
      }

      return json({ initialized, total: profiles!.length });
    }

    // --- Single user ---
    if (!targetUserId) {
      return json({ error: "No user_id provided" }, 400);
    }

    // If targeting another user, require admin
    if (callerId && targetUserId !== callerId) {
      const denied = await requireAdmin();
      if (denied) return denied;
    }

    const period = await ensureForUser(targetUserId);
    return json(period);
  } catch (err) {
    console.error("ensure-token-allowance error:", err);
    return json({ error: err.message || "Internal server error" }, 500);
  }
});
