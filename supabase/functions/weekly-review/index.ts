import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.47.10";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const OPENROUTER_API_KEY = Deno.env.get("OPENROUTER_API_KEY")!;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Auth check
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Missing authorization" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const supabaseUser = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });

    const {
      data: { user },
      error: userError,
    } = await supabaseUser.auth.getUser();
    if (userError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json().catch(() => ({}));
    const days = body.days || 7;

    const since = new Date();
    since.setDate(since.getDate() - days);
    const weekStart = since.toISOString().split("T")[0];
    const weekEnd = new Date().toISOString().split("T")[0];

    // Fetch notes from the period
    const { data: notes, error: notesError } = await supabaseAdmin
      .from("notes")
      .select("id, title, content, metadata, tags, created_at, entity_type")
      .eq("user_id", user.id)
      .eq("is_trashed", false)
      .gte("created_at", since.toISOString())
      .order("created_at", { ascending: false });

    if (notesError) {
      return new Response(JSON.stringify({ error: notesError.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!notes || notes.length === 0) {
      return new Response(
        JSON.stringify({ error: "No notes found in this period. Capture some thoughts first!" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Prepare notes for the LLM
    const noteSummaries = notes.map((n, i) => {
      const m = (n.metadata || {}) as Record<string, unknown>;
      const parts = [
        `[${i + 1}] id=${n.id}`,
        `date=${new Date(n.created_at).toLocaleDateString()}`,
        `type=${m.type || n.entity_type || "unknown"}`,
      ];
      if (Array.isArray(m.topics) && m.topics.length) parts.push(`topics=${(m.topics as string[]).join(",")}`);
      if (Array.isArray(m.people) && m.people.length) parts.push(`people=${(m.people as string[]).join(",")}`);
      if (Array.isArray(m.action_items) && m.action_items.length) {
        const completed = Array.isArray(m.completed_actions) ? m.completed_actions as string[] : [];
        const open = (m.action_items as string[]).filter((a) => !completed.includes(a));
        if (open.length) parts.push(`open_actions=${open.join("; ")}`);
      }
      parts.push(`\n${n.content.substring(0, 500)}`);
      return parts.join(" | ");
    });

    const prompt = `Analyze these ${notes.length} notes captured over the past ${days} days by a single person. Return JSON with:

- "week_summary": 2-3 sentence overview of the week's themes and activity
- "themes": array of {name, note_count, synthesis} — the 3-5 dominant topics with a synthesis paragraph each
- "open_loops": array of {action_item, source_note_title, captured_date, urgency} — unresolved action items. urgency is "high", "medium", or "low"
- "connections": array of {note_title_1, note_title_2, connection_description} — non-obvious links between notes from different days/contexts
- "gaps": array of strings — what's conspicuously absent based on the person's apparent priorities
- "people_summary": array of {name, interaction_count, latest_context}
- "stats": {total_notes, by_type_counts (object of type->count), most_active_day (day name)}

Notes:
${noteSummaries.join("\n\n")}`;

    const llmResponse = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENROUTER_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "openai/gpt-4o-mini",
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content:
              "You are an insightful personal knowledge analyst. Analyze captured thoughts and produce a structured weekly review. Be specific and reference actual content from the notes. Return valid JSON only.",
          },
          { role: "user", content: prompt },
        ],
      }),
    });

    if (!llmResponse.ok) {
      const errText = await llmResponse.text().catch(() => "");
      console.error("LLM error:", llmResponse.status, errText);
      return new Response(JSON.stringify({ error: "AI analysis failed" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const llmData = await llmResponse.json();
    let reviewData: Record<string, unknown>;
    try {
      reviewData = JSON.parse(llmData.choices[0].message.content);
    } catch {
      return new Response(JSON.stringify({ error: "Failed to parse AI response" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Store the review
    const { data: savedReview, error: saveError } = await supabaseAdmin
      .from("weekly_reviews")
      .insert({
        user_id: user.id,
        week_start: weekStart,
        week_end: weekEnd,
        review_data: reviewData,
      })
      .select("id, week_start, week_end, review_data, created_at")
      .single();

    if (saveError) {
      console.error("Save error:", saveError);
      // Still return the review even if save fails
      return new Response(
        JSON.stringify({ review: reviewData, week_start: weekStart, week_end: weekEnd, saved: false }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(JSON.stringify({ ...savedReview, saved: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("weekly-review error:", err);
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
