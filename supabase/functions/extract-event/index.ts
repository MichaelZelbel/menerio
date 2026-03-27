import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY")!;
const AI_GATEWAY = "https://ai.gateway.lovable.dev/v1/chat/completions";

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

    const { content } = await req.json();
    if (!content || typeof content !== "string") {
      return new Response(JSON.stringify({ error: "content (string) required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const today = new Date().toISOString().split("T")[0];

    const response = await fetch(AI_GATEWAY, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        tools: [
          {
            type: "function",
            function: {
              name: "extract_event",
              description:
                "Extract a timeline event from the note content for use in a timeline app.",
              parameters: {
                type: "object",
                properties: {
                  headline: {
                    type: "string",
                    description: "Short event title/headline",
                  },
                  description: {
                    type: "string",
                    description: "Event description or context",
                  },
                  happened_at: {
                    type: "string",
                    description: "Start date in YYYY-MM-DD format",
                  },
                  happened_end: {
                    type: "string",
                    description:
                      "End date in YYYY-MM-DD format, or null if single-day event",
                  },
                  status: {
                    type: "string",
                    enum: ["past_fact", "future_plan", "ongoing", "unknown"],
                    description: "Event status relative to current date",
                  },
                  impact_level: {
                    type: "integer",
                    minimum: 1,
                    maximum: 4,
                    description: "1=minor, 2=moderate, 3=significant, 4=major",
                  },
                  confidence_date: {
                    type: "integer",
                    minimum: 0,
                    maximum: 10,
                    description:
                      "How confident is the date (0=guess, 10=certain)",
                  },
                  confidence_truth: {
                    type: "integer",
                    minimum: 0,
                    maximum: 10,
                    description:
                      "How confident is this event real/true (0=rumor, 10=confirmed)",
                  },
                  participants: {
                    type: "array",
                    items: { type: "string" },
                    description: "Names of people involved",
                  },
                },
                required: ["headline", "happened_at", "status"],
                additionalProperties: false,
              },
            },
          },
        ],
        tool_choice: {
          type: "function",
          function: { name: "extract_event" },
        },
        messages: [
          {
            role: "system",
            content: `You extract timeline events from personal notes. Today is ${today}. Determine if the event is past, future, or ongoing relative to today. Be concise in the headline. Set confidence scores based on how explicit the information is in the note.`,
          },
          { role: "user", content },
        ],
      }),
    });

    if (!response.ok) {
      const status = response.status;
      if (status === 429) {
        return new Response(
          JSON.stringify({ error: "Rate limited, please try again later." }),
          { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      if (status === 402) {
        return new Response(
          JSON.stringify({ error: "AI credits exhausted. Please add funds." }),
          { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      const t = await response.text();
      console.error("AI gateway error:", status, t);
      return new Response(JSON.stringify({ error: "AI extraction failed" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const result = await response.json();
    const toolCall = result.choices?.[0]?.message?.tool_calls?.[0];
    if (!toolCall) {
      return new Response(
        JSON.stringify({ error: "AI did not return structured event data" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const eventData = JSON.parse(toolCall.function.arguments);

    return new Response(JSON.stringify({ event: eventData }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("extract-event error:", err);
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
