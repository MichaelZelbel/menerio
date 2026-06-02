import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { openRouterWithCredits, insufficientCreditsResponse } from "../_shared/llm-credits.ts";
import { resolveSystemPrompt } from "../_shared/llm-router.ts";
import { DRAFT_EVENT_PROMPT } from "../_shared/llm-defaults.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// System prompt now resolved at runtime from llm_call_configs (call_site: "draft-event.main").
// Placeholders: {{currentDate}}, {{peopleContext}}. Falls back to DRAFT_EVENT_PROMPT in llm-defaults.ts.

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

const REQUIRED_KEYS = ["happened_at", "title", "status", "impact_level", "confidence_date", "confidence_truth"];

function tryExtractJson(text: string): Record<string, unknown> | null {
  if (!text) return null;
  // strip code fences
  let cleaned = text.replace(/```json\s*/gi, "").replace(/```/g, "").trim();
  // find first { ... last }
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;
  cleaned = cleaned.slice(start, end + 1);
  try {
    return JSON.parse(cleaned);
  } catch {
    try {
      // light repair
      cleaned = cleaned
        .replace(/,\s*}/g, "}")
        .replace(/,\s*]/g, "]")
        .split("")
        .map((char) => {
          const code = char.charCodeAt(0);
          return code <= 31 || code === 127 ? " " : char;
        })
        .join("");
      return JSON.parse(cleaned);
    } catch {
      return null;
    }
  }
}

function looksLikeRefusal(text: string): boolean {
  if (!text) return false;
  const t = text.toLowerCase();
  return ["i cannot", "i can't", "i'm unable", "as a language model", "i apologize", "i won't", "cannot help with", "unable to assist"].some((p) => t.includes(p));
}

function validateDraft(d: Record<string, unknown>): boolean {
  return REQUIRED_KEYS.every((k) => d[k] !== undefined && d[k] !== null && d[k] !== "");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) return json({ error: "Unauthorized", code: "UNAUTHORIZED" }, 401);

    const supabaseAdmin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(authHeader.replace("Bearer ", ""));
    if (authError || !user) return json({ error: "Unauthorized", code: "UNAUTHORIZED" }, 401);

    const { messages, today, people } = await req.json();
    if (!Array.isArray(messages) || messages.length === 0) return json({ error: "messages are required", code: "BAD_INPUT" }, 400);

    const apiKey = Deno.env.get("OPENROUTER_API_KEY");
    if (!apiKey) throw new Error("OPENROUTER_API_KEY is not configured");

    const peopleContext = Array.isArray(people) && people.length > 0
      ? `\n\nKnown people in the user's timeline: ${people.map((p: { name: string }) => p.name).join(", ")}`
      : "";

    const lastUser = [...messages].reverse().find((m: any) => m.role === "user");
    const descLength = typeof lastUser?.content === "string" ? lastUser.content.length : 0;
    console.log(`[draft-event] start user=${user.id} desc_len=${descLength}`);

    const systemPromptResolved = await resolveSystemPrompt(
      supabaseAdmin,
      "draft-event.main",
      DRAFT_EVENT_PROMPT,
      {
        currentDate: today || new Date().toISOString().split("T")[0],
        peopleContext,
      },
    );
    const systemMessage = { role: "system", content: systemPromptResolved };

    const schema = {
      type: "object",
      properties: {
        happened_at: { type: "string", description: "YYYY-MM-DD format" },
        happened_end: { type: ["string", "null"], description: "YYYY-MM-DD format or null" },
        title: { type: "string", description: "Clear, descriptive headline" },
        description: { type: "string", description: "Short factual description" },
        status: { type: "string", enum: ["past_fact", "future_plan", "ongoing", "unknown"] },
        impact_level: { type: "integer", minimum: 1, maximum: 4 },
        confidence_date: { type: "integer", minimum: 0, maximum: 10 },
        confidence_truth: { type: "integer", minimum: 0, maximum: 10 },
        participants: { type: "array", items: { type: "string" } },
      },
      required: REQUIRED_KEYS,
      additionalProperties: false,
    };

    let result: any;
    let credits: any;
    try {
      const resp = await openRouterWithCredits(
        supabaseAdmin,
        apiKey,
        user.id,
        "draft-event",
        "chat/completions",
        {
          model: "google/gemini-2.5-flash",
          temperature: 0.2,
          messages: [systemMessage, ...messages],
          tools: [{
            type: "function",
            function: {
              name: "draft_moment",
              description: "Return a structured timeline moment draft based on the user's description.",
              parameters: schema,
            },
          }],
          tool_choice: { type: "function", function: { name: "draft_moment" } },
        }
      );
      result = resp.result;
      credits = resp.credits;
    } catch (providerErr) {
      const msg = providerErr instanceof Error ? providerErr.message : String(providerErr);
      if (msg === "INSUFFICIENT_CREDITS" || msg === "NO_ACTIVE_PERIOD") throw providerErr;
      console.error("[draft-event] provider error:", msg);
      return json({ error: msg.slice(0, 400), code: "PROVIDER_ERROR" }, 502);
    }

    const choice = result.choices?.[0];
    const finishReason = choice?.finish_reason;
    const toolCall = choice?.message?.tool_calls?.[0];
    const content: string = choice?.message?.content || "";

    let draft: Record<string, unknown> | null = null;
    let extractionPath = "none";

    if (toolCall?.function?.name === "draft_moment") {
      try {
        draft = JSON.parse(toolCall.function.arguments);
        extractionPath = "tool_call";
      } catch (e) {
        console.warn("[draft-event] tool_call JSON parse failed:", e);
      }
    }

    if (!draft) {
      const fromContent = tryExtractJson(content);
      if (fromContent && validateDraft(fromContent)) {
        draft = fromContent;
        extractionPath = "content_json";
      }
    }

    console.log(`[draft-event] done finish=${finishReason} path=${extractionPath} desc_len=${descLength}`);

    if (!draft || !validateDraft(draft)) {
      if (finishReason === "length") {
        return json({
          error: "AI response was cut off. The description is likely too long.",
          code: "AI_TRUNCATED",
          finish_reason: finishReason,
        }, 422);
      }
      if (looksLikeRefusal(content)) {
        return json({
          error: "AI refused to draft this description.",
          code: "AI_REFUSED",
          snippet: content.slice(0, 200),
        }, 422);
      }
      return json({
        error: "AI did not return a usable draft.",
        code: "AI_NO_DRAFT",
        finish_reason: finishReason,
        snippet: content.slice(0, 200),
      }, 422);
    }

    return json({ draft, credits });
  } catch (err) {
    if (err instanceof Error && (err.message === "INSUFFICIENT_CREDITS" || err.message === "NO_ACTIVE_PERIOD")) {
      return insufficientCreditsResponse(corsHeaders);
    }
    console.error("draft-event error:", err);
    return json({ error: err instanceof Error ? err.message : "Unknown error", code: "INTERNAL" }, 500);
  }
});
