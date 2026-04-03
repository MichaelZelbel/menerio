import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // Auth: require logged-in Menerio user
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return json({ error: "Unauthorized" }, 401);
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const token = authHeader.replace("Bearer ", "");
    const { data: claimsData, error: claimsErr } = await supabase.auth.getClaims(token);
    if (claimsErr || !claimsData?.claims) {
      return json({ error: "Unauthorized" }, 401);
    }
    const userId = claimsData.claims.sub as string;

    // Parse optional target app from body (default: clarinio)
    const body = await req.json().catch(() => ({}));
    const targetApp = body.target_app || "clarinio";

    // Get bridge key and URL based on target
    const bridgeKeyName = `${targetApp.toUpperCase()}_BRIDGE_KEY`;
    const urlName = `${targetApp.toUpperCase()}_URL`;
    const BRIDGE_KEY = Deno.env.get(bridgeKeyName);
    const TARGET_URL = Deno.env.get(urlName);

    if (!BRIDGE_KEY || !TARGET_URL) {
      return json({ error: `${targetApp} integration not configured. Set ${bridgeKeyName} and ${urlName}.` }, 500);
    }

    // Get user email for cross-app matching
    const { data: userData } = await supabase.auth.getUser(token);
    const email = userData?.user?.email;
    if (!email) {
      return json({ error: "Could not determine user email" }, 400);
    }

    // Fetch profile data
    const serviceSupabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const [categoriesRes, entriesRes, instructionsRes] = await Promise.all([
      serviceSupabase
        .from("profile_categories")
        .select("*")
        .eq("user_id", userId)
        .order("sort_order"),
      serviceSupabase
        .from("profile_entries")
        .select("*")
        .eq("user_id", userId)
        .order("sort_order"),
      serviceSupabase
        .from("agent_instructions")
        .select("*")
        .eq("user_id", userId)
        .order("sort_order"),
    ]);

    if (categoriesRes.error) throw categoriesRes.error;
    if (entriesRes.error) throw entriesRes.error;
    if (instructionsRes.error) throw instructionsRes.error;

    // Push to target app
    const response = await fetch(
      `${TARGET_URL}/functions/v1/receive-profile`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-bridge-key": BRIDGE_KEY,
        },
        body: JSON.stringify({
          email,
          source: "menerio",
          categories: categoriesRes.data.map((c: any) => ({
            slug: c.slug,
            name: c.name,
            icon: c.icon,
            description: c.description,
            sort_order: c.sort_order,
            visibility_scope: c.visibility_scope,
            is_default: c.is_default,
          })),
          entries: entriesRes.data.map((e: any) => ({
            category_slug: categoriesRes.data.find((c: any) => c.id === e.category_id)?.slug || "unknown",
            label: e.label,
            value: e.value,
            sort_order: e.sort_order,
          })),
          instructions: instructionsRes.data.map((i: any) => ({
            instruction: i.instruction,
            applies_to: i.applies_to,
            is_active: i.is_active,
            sort_order: i.sort_order,
          })),
        }),
      }
    );

    const result = await response.json();

    if (!response.ok) {
      console.error("Push profile error:", response.status, result);
      return json({ error: result.error || "Target app rejected the request" }, response.status);
    }

    return json({ ok: true, ...result });
  } catch (err) {
    console.error("push-profile error:", err);
    return json({ error: (err as Error).message || "Internal error" }, 500);
  }
});
