import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { runChat, type Provider } from "../_shared/llm-router.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

const PROVIDER_SECRETS: Record<Provider, string> = {
  lovable: "LOVABLE_API_KEY",
  openrouter: "OPENROUTER_API_KEY",
  openai: "OPENAI_API_KEY",
  anthropic: "ANTHROPIC_API_KEY",
  gemini: "GEMINI_API_KEY",
  mistral: "MISTRAL_API_KEY",
};

function providerAvailability(): Record<Provider, boolean> {
  const out = {} as Record<Provider, boolean>;
  for (const [p, env] of Object.entries(PROVIDER_SECRETS) as [Provider, string][]) {
    out[p] = !!Deno.env.get(env);
  }
  return out;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Unauthorized" }, 401);

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );
    const userClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return json({ error: "Unauthorized" }, 401);

    const { data: isAdminRow } = await admin.rpc("is_admin", { _user_id: user.id });
    if (!isAdminRow) return json({ error: "Forbidden — admin only" }, 403);

    const body = await req.json().catch(() => ({}));
    const action = body.action as string;

    if (action === "list") {
      const { data: rows, error } = await admin
        .from("llm_call_configs")
        .select("*")
        .order("call_site");
      if (error) throw error;
      return json({
        configs: rows ?? [],
        availability: providerAvailability(),
      });
    }

    if (action === "test") {
      const callSite = String(body.call_site || "");
      const userPrompt = String(body.prompt || "Sag 'Hallo' und nenne das Modell und den Provider, den du nutzt.");
      if (!callSite) return json({ error: "call_site required" }, 400);

      const { data: row, error } = await admin
        .from("llm_call_configs")
        .select("*")
        .eq("call_site", callSite)
        .maybeSingle();
      if (error) throw error;
      if (!row) return json({ error: "Unknown call_site" }, 404);

      const startedAt = Date.now();
      try {
        const result = await runChat({
          db: admin,
          userId: user.id,
          callSite,
          messages: [{ role: "user", content: userPrompt }],
          defaults: { provider: row.provider, model: row.model },
        });
        return json({
          ok: true,
          provider: result.provider,
          model: result.model,
          content: result.content,
          config_source: result.configSource,
          latency_ms: Date.now() - startedAt,
          credits: result.credits,
        });
      } catch (err) {
        return json({
          ok: false,
          error: (err as Error).message,
          latency_ms: Date.now() - startedAt,
        }, 200);
      }
    }

    return json({ error: "Unknown action" }, 400);
  } catch (err) {
    console.error("admin-llm-config error:", err);
    return json({ error: (err as Error).message }, 500);
  }
});
