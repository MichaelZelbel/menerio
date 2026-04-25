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

Think of yourself as a light copy-editor, not a writer.`;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);

    const supabaseAdmin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(authHeader.replace("Bearer ", ""));
    if (authError || !user) return json({ error: "Unauthorized" }, 401);

    const { messages, today, people } = await req.json();
    if (!Array.isArray(messages) || messages.length === 0) return json({ error: "messages are required" }, 400);

    const apiKey = Deno.env.get("OPENROUTER_API_KEY");
    if (!apiKey) throw new Error("OPENROUTER_API_KEY is not configured");

    const peopleContext = Array.isArray(people) && people.length > 0
      ? `\n\nKnown people in the user's timeline: ${people.map((p: { name: string }) => p.name).join(", ")}`
      : "";

    const systemMessage = {
      role: "system",
      content: `${SYSTEM_PROMPT}\n\nToday's date: ${today || new Date().toISOString().split("T")[0]}${peopleContext}`,
    };

    const { result, credits } = await openRouterWithCredits(
      supabaseAdmin,
      apiKey,
      user.id,
      "draft-event",
      "chat/completions",
      {
        model: "google/gemini-3-flash-preview",
        messages: [systemMessage, ...messages],
        tools: [{
          type: "function",
          function: {
            name: "draft_moment",
            description: "Return a structured timeline moment draft based on the user's description.",
            parameters: {
              type: "object",
              properties: {
                happened_at: { type: "string", description: "YYYY-MM-DD format" },
                happened_end: { type: "string", description: "YYYY-MM-DD format or null" },
                title: { type: "string", description: "Clear, descriptive headline" },
                description: { type: "string", description: "Short factual description" },
                status: { type: "string", enum: ["past_fact", "future_plan", "ongoing", "unknown"] },
                impact_level: { type: "integer", minimum: 1, maximum: 4 },
                confidence_date: { type: "integer", minimum: 0, maximum: 10 },
                confidence_truth: { type: "integer", minimum: 0, maximum: 10 },
                participants: { type: "array", items: { type: "string" }, description: "List of person names mentioned" },
              },
              required: ["happened_at", "title", "status", "impact_level", "confidence_date", "confidence_truth"],
              additionalProperties: false,
            },
          },
        }],
        tool_choice: { type: "function", function: { name: "draft_moment" } },
      }
    );

    const toolCall = result.choices?.[0]?.message?.tool_calls?.[0];
    if (!toolCall || toolCall.function.name !== "draft_moment") return json({ error: "AI did not return a valid moment draft" }, 500);

    return json({ draft: JSON.parse(toolCall.function.arguments), credits });
  } catch (err) {
    if (err instanceof Error && (err.message === "INSUFFICIENT_CREDITS" || err.message === "NO_ACTIVE_PERIOD")) {
      return insufficientCreditsResponse(corsHeaders);
    }
    console.error("draft-event error:", err);
    return json({ error: err instanceof Error ? err.message : "Unknown error" }, 500);
  }
});
