import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  balanceUnavailableResponse,
  checkBalance,
  insufficientCreditsResponse,
} from "../_shared/llm-credits.ts";
import { runChat } from "../_shared/llm-router.ts";
import { EXTRACT_EVENT_PROMPT } from "../_shared/llm-defaults.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

/**
 * The event shape the caller parses out of the reply.
 *
 * This is a forced tool call, so whatever `llm_call_configs` names as the model
 * for `extract-event.main` MUST support forced function calling. The code used to
 * hardcode google/gemini-3-flash-preview on the Lovable gateway regardless of what
 * the row said, so the row has never actually been exercised. Confirm the row's
 * model before relying on this in production.
 */
const EXTRACT_EVENT_TOOL = {
  type: "function" as const,
  function: {
    name: "extract_event",
    description:
      "Extract a timeline event from the note content for use in a timeline app.",
    parameters: {
      type: "object",
      properties: {
        headline: { type: "string", description: "Short event title/headline" },
        description: { type: "string", description: "Event description or context" },
        happened_at: { type: "string", description: "Start date in YYYY-MM-DD format" },
        happened_end: { type: "string", description: "End date in YYYY-MM-DD format, or null if single-day event" },
        status: { type: "string", enum: ["past_fact", "future_plan", "ongoing", "unknown"], description: "Event status relative to current date" },
        impact_level: { type: "integer", minimum: 1, maximum: 4, description: "1=minor, 2=moderate, 3=significant, 4=major" },
        confidence_date: { type: "integer", minimum: 0, maximum: 10, description: "How confident is the date (0=guess, 10=certain)" },
        confidence_truth: { type: "integer", minimum: 0, maximum: 10, description: "How confident is this event real/true (0=rumor, 10=confirmed)" },
        participants: { type: "array", items: { type: "string" }, description: "Names of people involved" },
      },
      required: ["headline", "happened_at", "status"],
      additionalProperties: false,
    },
  },
};

const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

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
    // Verify auth
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: authErr } = await db.auth.getUser(token);
    if (authErr || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Pre-check balance
    const balance = await checkBalance(db, user.id);
    if (!balance.allowed) {
      return balance.unavailable
        ? balanceUnavailableResponse(corsHeaders)
        : insufficientCreditsResponse(corsHeaders);
    }

    const { content } = await req.json();
    if (!content || typeof content !== "string") {
      return new Response(JSON.stringify({ error: "content (string) required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const today = new Date().toISOString().split("T")[0];

    // The row in `llm_call_configs` decides the provider, the model and the
    // prompt. This function used to hardcode all three (the Lovable gateway,
    // google/gemini-3-flash-preview, and its own inline copy of the prompt) while
    // its row said openrouter, so the admin screen described a call that was not
    // happening, and editing any of the three there changed nothing. It also
    // reported "lovable" to the ledger as a hardcoded string; runChat now reports
    // whichever provider actually ran.
    const result = await runChat({
      db,
      userId: user.id,
      callSite: "extract-event.main",
      messages: [{ role: "user", content }],
      defaults: {
        provider: "openrouter",
        model: "deepseek/deepseek-v4-flash",
        systemPrompt: EXTRACT_EVENT_PROMPT,
      },
      templateVars: { currentDate: today },
      callOptions: {
        tools: [EXTRACT_EVENT_TOOL],
        tool_choice: { type: "function", function: { name: "extract_event" } },
      },
    });

    // Forced tool call, so the answer is in `raw`, not in `content`.
    const toolCall = (result.raw as any)?.choices?.[0]?.message?.tool_calls?.[0];
    if (!toolCall) {
      console.error(
        `extract-event: no tool call (provider=${result.provider}, model=${result.model}, config=${result.configSource}). ` +
          `The configured model must support forced function calling.`,
      );
      return new Response(
        JSON.stringify({ error: "AI did not return structured event data" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const eventData = JSON.parse(toolCall.function.arguments);
    const credits = result.credits
      ? {
          remaining_tokens: result.credits.remaining_tokens,
          remaining_credits: result.credits.remaining_credits,
        }
      : null;

    return new Response(JSON.stringify({ event: eventData, credits }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: any) {
    if (err?.message === "BALANCE_UNAVAILABLE") {
      return balanceUnavailableResponse(corsHeaders);
    }
    if (err.message === "INSUFFICIENT_CREDITS" || err.message === "NO_ACTIVE_PERIOD") {
      return insufficientCreditsResponse(corsHeaders);
    }
    console.error("extract-event error:", err);
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
