import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Verify Menerio user auth
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const token = authHeader.replace("Bearer ", "");
    const { data: claimsData, error: claimsErr } = await supabase.auth.getClaims(token);
    if (claimsErr || !claimsData?.claims) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json();
    const {
      email,
      headline,
      description,
      happened_at,
      happened_end,
      status,
      impact_level,
      confidence_date,
      confidence_truth,
    } = body;

    if (!headline || !happened_at || !email) {
      return new Response(
        JSON.stringify({ error: "headline, happened_at, and email are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const TEMERIO_BRIDGE_KEY = Deno.env.get("TEMERIO_BRIDGE_KEY");
    const TEMERIO_URL = Deno.env.get("TEMERIO_URL");

    if (!TEMERIO_BRIDGE_KEY || !TEMERIO_URL) {
      return new Response(
        JSON.stringify({
          error: "Temerio integration not configured. Please set TEMERIO_BRIDGE_KEY and TEMERIO_URL secrets.",
        }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Call Temerio's create-moment-external edge function
    const temerioResponse = await fetch(
      `${TEMERIO_URL}/functions/v1/create-moment-external`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-bridge-key": TEMERIO_BRIDGE_KEY,
        },
        body: JSON.stringify({
          email,
          headline,
          description: description || null,
          happened_at,
          happened_end: happened_end || null,
          status: status || "unknown",
          impact_level: impact_level || 2,
          confidence_date: confidence_date ?? 7,
          confidence_truth: confidence_truth ?? 8,
          source: "menerio",
        }),
      }
    );

    const temerioResult = await temerioResponse.json();

    if (!temerioResponse.ok) {
      console.error("Temerio error:", temerioResponse.status, temerioResult);
      return new Response(
        JSON.stringify({ error: temerioResult.error || "Temerio rejected the request" }),
        {
          status: temerioResponse.status,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    return new Response(JSON.stringify(temerioResult), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("send-to-temerio error:", err);
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
