import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { sha256Hex } from "../_shared/sha256.ts";
import {
  checkBalance,
  getEmbeddingWithCredits,
  insufficientCreditsResponse,
  balanceUnavailableResponse,
} from "../_shared/llm-credits.ts";
import { runChat, sourceLanguageRule } from "../_shared/llm-router.ts";
import { QUICK_CAPTURE_METADATA_PROMPT, metadataFieldContract } from "../_shared/llm-defaults.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const OPENROUTER_API_KEY = Deno.env.get("OPENROUTER_API_KEY")!;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-api-key",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// (system prompt lives in `_shared/llm-defaults.ts` so the Admin Dashboard can override it)

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Authenticate: accept either x-api-key or Authorization bearer
    let userId: string | null = null;
    let sourceName = "api";

    const apiKey = req.headers.get("x-api-key");
    const authHeader = req.headers.get("Authorization");

    if (apiKey) {
      const { data: app, error: appErr } = await supabase
        .from("connected_apps")
        .select("user_id, app_name, is_active")
        .eq("key_hash", await sha256Hex(apiKey))
        .single();

      if (appErr || !app || !app.is_active) {
        return json({ error: "unauthorized" }, 401);
      }
      userId = app.user_id;
      sourceName = app.app_name;
    } else if (authHeader) {
      const token = authHeader.replace("Bearer ", "");
      const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
      if (authErr || !user) return json({ error: "unauthorized" }, 401);
      userId = user.id;
      sourceName = "web";
    } else {
      return json({ error: "unauthorized" }, 401);
    }

    if (!userId) return json({ error: "unauthorized" }, 401);

    // Pre-check balance
    const balance = await checkBalance(supabase, userId);
    if (!balance.allowed) {
      return balance.unavailable
        ? balanceUnavailableResponse(corsHeaders)
        : insufficientCreditsResponse(corsHeaders);
    }

    const body = await req.json();
    const content = (body.content || "").trim();
    if (!content) return json({ error: "content is required" }, 400);

    const source = body.source || sourceName;
    let title = content.slice(0, 50).replace(/\n/g, " ") + (content.length > 50 ? "…" : "");

    // Create the note first
    const { data: note, error: insertErr } = await supabase
      .from("notes")
      .insert({
        user_id: userId,
        title,
        content,
        metadata: { is_quick_capture: true, source },
      })
      .select("id")
      .single();

    if (insertErr) throw insertErr;

    // Generate embedding + extract metadata with credit deduction
    let metadata: Record<string, unknown> = {};
    let credits = null;
    try {
      const [embResult, chatResult] = await Promise.all([
        getEmbeddingWithCredits(supabase, OPENROUTER_API_KEY, userId, "quick-capture", content).catch(() => null),
        runChat({
          db: supabase,
          userId,
          callSite: "quick-capture.metadata",
          messages: [{ role: "user", content }],
          defaults: {
            provider: "openrouter",
            model: "deepseek/deepseek-v4-flash",
            systemPrompt: QUICK_CAPTURE_METADATA_PROMPT,
          },
          systemSuffix: [metadataFieldContract(), sourceLanguageRule()].join("\n\n"),
          callOptions: { response_format: { type: "json_object" } },
        }),
      ]);

      let extracted: Record<string, unknown> = {};
      try {
        extracted = JSON.parse(chatResult.content);
      } catch {
        extracted = { topics: ["uncategorized"], type: "observation", sentiment: "neutral" };
      }

      metadata = { ...extracted, is_quick_capture: true, source };
      credits = chatResult.credits;

      // Use AI-generated title if available
      const aiTitle = typeof extracted.title === "string" && extracted.title.trim()
        ? extracted.title.trim()
        : title;

      const updatePayload: Record<string, unknown> = { metadata, title: aiTitle };
      if (embResult) updatePayload.embedding = embResult.embedding;

      await supabase.from("notes").update(updatePayload).eq("id", note.id);
      title = aiTitle;
    } catch (err: any) {
      if (err.message === "INSUFFICIENT_CREDITS") {
        // Note was created but AI processing skipped due to credits
        console.log("Quick capture: note created but AI processing skipped (insufficient credits)");
      } else {
        console.error("Processing error (non-fatal):", err);
      }
    }

    return json({
      ok: true,
      note_id: note.id,
      title,
      metadata,
      credits: credits ? {
        remaining_tokens: credits.remaining_tokens,
        remaining_credits: credits.remaining_credits,
      } : null,
    }, 201);
  } catch (err: any) {
    if (err.message === "INSUFFICIENT_CREDITS" || err.message === "NO_ACTIVE_PERIOD") {
      return insufficientCreditsResponse(corsHeaders);
    }
    console.error("quick-capture error:", err);
    return json({ error: err.message }, 500);
  }
});
