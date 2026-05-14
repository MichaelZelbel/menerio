import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { openRouterWithCredits, insufficientCreditsResponse } from "../_shared/llm-credits.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const SYSTEM_PROMPT = `You are an assistant that helps structure life moments for a personal timeline app called Menerio.

The user will describe something that happened (or will happen). Your job is to extract a structured moment from their description.

IMPACT LEVEL (1-4) — measures structural life impact, NOT emotion:
1 = Minor (routine activities, small errands, casual meetups)
2 = Noticeable (starting a hobby, moderate financial decision, moving apartments)
3 = Strong Impact (changing jobs, moving cities, marriage, founding a company)
4 = Life-Shaping (immigration, becoming a parent, life-defining decisions)

Default typical personal events to 1-2 unless clearly chapter-changing.

CONFIDENCE scales (0-10):
- confidence_date: How certain is the date? 10 = exact date given, 5 = approximate, 0 = pure guess
- confidence_truth: How certain is the event true/accurate? 10 = firsthand confirmed, 5 = plausible, 0 = rumor

Use conservative confidence values unless the user indicates strong certainty.

STATUS values:
- past_fact: Already happened
- future_plan: Planned for the future
- ongoing: Currently happening
- unknown: Unclear

Rules:
- Title must be explicit and descriptive (not vague like "Something happened"). The title is a separate, clean headline you may freely write.
- If no date is mentioned, use today's date provided in the context
- participants should list person names mentioned, can be empty array

DESCRIPTION FIELD — STRICT FIDELITY RULES:
The description must stay as close as possible to the user's original wording. Treat the user's text as the source of truth, not a starting point for your own writing.

DO:
- Reuse the user's own words, phrases, and sentence structure wherever possible.
- Only fix grammar, spelling, punctuation, capitalization, and obvious typos.
- Remove filler words ("um", "uh", "like", "you know", "basically", "I mean") and pure redundancy.
- If the user wrote a single sentence, keep it as a single sentence.
- If the user wrote in first person, keep it in first person. Same for tense.

DO NOT:
- Do NOT add facts, details, interpretations, emotions, or context the user did not provide.
- Do NOT embellish, dramatize, or add adjectives/adverbs that weren't there.
- Do NOT rephrase for style, flow, or tone.
- Do NOT summarize or shorten unless the input is clearly very long (>500 characters).
- Do NOT expand short input into longer prose.
- Do NOT translate unless the user asks.

Think of yourself as a light copy-editor, not a writer.

OUTPUT FORMAT:
You MUST call the draft_moment function. If you cannot use function-calling, return ONLY a JSON object matching the schema, with no surrounding prose or markdown.`;

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

    const systemMessage = {
      role: "system",
      content: `${SYSTEM_PROMPT}\n\nToday's date: ${today || new Date().toISOString().split("T")[0]}${peopleContext}`,
    };

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
