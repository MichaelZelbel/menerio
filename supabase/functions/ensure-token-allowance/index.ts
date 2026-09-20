import { createClient } from "npm:@supabase/supabase-js@2";
import { ensureAllowanceForUser } from "../_shared/ensure-allowance.ts";

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
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? Deno.env.get("SUPABASE_PUBLISHABLE_KEY");

    if (!supabaseUrl || !serviceRoleKey || !anonKey) {
      console.error("ensure-token-allowance missing required Supabase environment variables");
      return json({ error: "Server configuration error" }, 500);
    }

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
        const authClient = createClient(supabaseUrl, anonKey);
        const { data, error } = await authClient.auth.getUser(token);
        if (error || !data?.user) {
          return json({ error: "Unauthorized" }, 401);
        }
        callerId = data.user.id;
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

    // The allowance itself is created by the shared helper, which the credit check
    // also calls, so an account nobody opened this month still gets its row.
    const ensureForUser = (userId: string) => ensureAllowanceForUser(db, userId);

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
    return json({ error: err instanceof Error ? err.message : "Internal server error" }, 500);
  }
});
