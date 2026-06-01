import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { runChat, type Provider } from "../_shared/llm-router.ts";
import { CALL_SITE_DEFAULTS, getCallSiteDefault } from "../_shared/llm-defaults.ts";

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

/**
 * Seed every known call site from the central defaults registry.
 *
 * `force` (default false): when true, every column is overwritten with the
 *   default values — destructive but necessary for first rollout / migrations.
 * When false: insert missing rows; for existing rows only backfill columns
 *   that are still null/empty so admin edits are preserved.
 */
async function syncDefaults(admin: any, force: boolean) {
  if (force) {
    const rows = CALL_SITE_DEFAULTS.map((d) => ({
      call_site: d.call_site,
      description: d.description,
      provider: d.provider,
      model: d.model,
      system_prompt: d.system_prompt,
      temperature: d.temperature,
      max_tokens: d.max_tokens,
      extra_options: d.extra_options,
      enabled: d.enabled,
    }));
    const { error } = await admin
      .from("llm_call_configs")
      .upsert(rows, { onConflict: "call_site" });
    if (error) throw error;
    return;
  }

  const { data: existing, error: readErr } = await admin
    .from("llm_call_configs")
    .select("call_site, description, system_prompt");
  if (readErr) throw readErr;
  const existingMap = new Map<string, { description: string | null; system_prompt: string | null }>(
    (existing ?? []).map((r: any) => [r.call_site, { description: r.description, system_prompt: r.system_prompt }])
  );

  const toInsert: any[] = [];
  const toBackfill: { call_site: string; description?: string; system_prompt?: string | null }[] = [];

  for (const d of CALL_SITE_DEFAULTS) {
    const row = existingMap.get(d.call_site);
    if (!row) {
      toInsert.push({
        call_site: d.call_site,
        description: d.description,
        provider: d.provider,
        model: d.model,
        system_prompt: d.system_prompt,
        temperature: d.temperature,
        max_tokens: d.max_tokens,
        extra_options: d.extra_options,
        enabled: d.enabled,
      });
      continue;
    }
    const patch: { call_site: string; description?: string; system_prompt?: string | null } = { call_site: d.call_site };
    if (!row.description || row.description.trim().length === 0) patch.description = d.description;
    if (d.system_prompt !== null && (!row.system_prompt || row.system_prompt.trim().length === 0)) {
      patch.system_prompt = d.system_prompt;
    }
    if (Object.keys(patch).length > 1) toBackfill.push(patch);
  }

  if (toInsert.length > 0) {
    const { error } = await admin.from("llm_call_configs").insert(toInsert);
    if (error) throw error;
  }
  for (const patch of toBackfill) {
    const { call_site, ...fields } = patch;
    const { error } = await admin.from("llm_call_configs").update(fields).eq("call_site", call_site);
    if (error) throw error;
  }
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
      // Backfill any missing rows / descriptions without clobbering admin edits.
      await syncDefaults(admin, false);
      const { data: rows, error } = await admin
        .from("llm_call_configs")
        .select("*")
        .order("call_site");
      if (error) throw error;
      // Attach placeholder metadata + non-chat flag from the registry.
      const enriched = (rows ?? []).map((r: any) => {
        const d = getCallSiteDefault(r.call_site);
        return {
          ...r,
          placeholders: d?.placeholders ?? [],
          is_chat: d ? d.system_prompt !== null : true,
        };
      });
      return json({
        configs: enriched,
        availability: providerAvailability(),
      });
    }

    if (action === "sync_defaults") {
      const force = body.force === true;
      await syncDefaults(admin, force);
      return json({ ok: true, force, synced: CALL_SITE_DEFAULTS.map((d) => d.call_site) });
    }

    if (action === "test") {
      const callSite = String(body.call_site || "");
      const userPrompt = String(body.prompt || "Say 'Hello' and tell me which model and provider you are using.");
      if (!callSite) return json({ error: "call_site required" }, 400);

      const { data: row, error } = await admin
        .from("llm_call_configs")
        .select("*")
        .eq("call_site", callSite)
        .maybeSingle();
      if (error) throw error;
      if (!row) return json({ error: "Unknown call_site" }, 404);

      // Non-chat endpoints (OCR / embeddings) can't be tested via chat.
      const def = getCallSiteDefault(callSite);
      const isChat = def ? def.system_prompt !== null : !(typeof row.model === "string" && row.model.includes("ocr"));
      if (!isChat) {
        return json({
          ok: false,
          error: "This endpoint is not a chat call — trigger it via a real upload/operation to verify.",
          provider: row.provider,
          model: row.model,
        });
      }

      const startedAt = Date.now();
      try {
        // Fill placeholder vars with obvious "[placeholder not provided in test]" strings.
        const templateVars: Record<string, string> = {};
        for (const ph of (def?.placeholders ?? [])) {
          templateVars[ph] = `[test value for {{${ph}}}]`;
        }
        const result = await runChat({
          db: admin,
          userId: user.id,
          callSite,
          messages: [{ role: "user", content: userPrompt }],
          defaults: { provider: row.provider, model: row.model },
          templateVars,
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
