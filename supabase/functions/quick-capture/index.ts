import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  checkBalance,
  getEmbeddingWithCredits,
  chatWithCredits,
  insufficientCreditsResponse,
} from "../_shared/llm-credits.ts";

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

const METADATA_SYSTEM_PROMPT = `Extract metadata from the user's note. Return JSON with:
- "people": array of people mentioned (empty if none)
- "action_items": array of implied to-dos (empty if none)
- "dates_mentioned": array of dates in YYYY-MM-DD format (empty if none)
- "topics": array of 1-5 short topic tags (always generate at least one)
- "type": one of "observation", "task", "idea", "reference", "person_note", "meeting_note", "decision", "project"
- "sentiment": one of "positive", "negative", "neutral"
- "summary": one-sentence summary of the note
Only extract what's explicitly there. Don't invent details.`;

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
        .eq("api_key", apiKey)
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

    // Pre-check balance
    const balance = await checkBalance(supabase, userId);
    if (!balance.allowed) {
      return insufficientCreditsResponse(corsHeaders);
    }

    const body = await req.json();
    const content = (body.content || "").trim();
    if (!content) return json({ error: "content is required" }, 400);

    const source = body.source || sourceName;
    const title = content.slice(0, 50).replace(/\n/g, " ") + (content.length > 50 ? "…" : "");

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
        chatWithCredits(
          supabase, OPENROUTER_API_KEY, userId, "quick-capture",
          [
            { role: "system", content: METADATA_SYSTEM_PROMPT },
            { role: "user", content },
          ],
          { response_format: { type: "json_object" } }
        ),
      ]);

      let extracted: Record<string, unknown> = {};
      try {
        extracted = JSON.parse(chatResult.result.choices[0].message.content);
      } catch {
        extracted = { topics: ["uncategorized"], type: "observation", sentiment: "neutral" };
      }

      metadata = { ...extracted, is_quick_capture: true, source };
      credits = chatResult.credits;

      const updatePayload: Record<string, unknown> = { metadata };
      if (embResult) updatePayload.embedding = embResult.embedding;

      await supabase.from("notes").update(updatePayload).eq("id", note.id);
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
