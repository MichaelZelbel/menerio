import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.47.10";
import {
  checkBalance,
  openRouterWithCredits,
  insufficientCreditsResponse,
} from "../_shared/llm-credits.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const OPENROUTER_API_KEY = Deno.env.get("OPENROUTER_API_KEY")!;

declare const EdgeRuntime: { waitUntil: (promise: Promise<unknown>) => void };

type NoteRow = {
  id: string;
  title: string;
  content: string | null;
  metadata: Record<string, unknown> | null;
  tags: string[] | null;
  created_at: string;
  entity_type: string | null;
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

function clampDays(value: unknown): number {
  const days = Number(value || 7);
  if (![7, 14, 30].includes(days)) return 7;
  return days;
}

function getPeriod(days: number) {
  const since = new Date();
  since.setDate(since.getDate() - days);
  return {
    since,
    weekStart: since.toISOString().split("T")[0],
    weekEnd: new Date().toISOString().split("T")[0],
  };
}

async function getAuthenticatedUser(authHeader: string | null) {
  if (!authHeader) return null;

  const supabaseUser = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });

  const {
    data: { user },
    error,
  } = await supabaseUser.auth.getUser();

  if (error || !user) return null;
  return user;
}

async function createWeeklyReviewForUser(
  supabaseAdmin: any,
  userId: string,
  days: number,
  options: { scheduled?: boolean } = {},
) {
  const { since, weekStart, weekEnd } = getPeriod(days);

  if (options.scheduled) {
    const { data: existing } = await supabaseAdmin
      .from("weekly_reviews")
      .select("id, week_start, week_end, created_at")
      .eq("user_id", userId)
      .eq("week_start", weekStart)
      .maybeSingle();

    if (existing) {
      return { skipped: "already_exists", existing: true, ...existing };
    }
  }

  const balance = await checkBalance(supabaseAdmin, userId);
  if (!balance.allowed) {
    return { skipped: "insufficient_credits" };
  }

  const { data: notes, error: notesError } = await supabaseAdmin
    .from("notes")
    .select("id, title, content, metadata, tags, created_at, entity_type")
    .eq("user_id", userId)
    .eq("is_trashed", false)
    .gte("created_at", since.toISOString())
    .order("created_at", { ascending: false });

  if (notesError) throw new Error(notesError.message);

  if (!notes || notes.length === 0) {
    return { skipped: "no_notes", week_start: weekStart, week_end: weekEnd };
  }

  const noteRows = notes as NoteRow[];

  const noteSummaries = noteRows.map((n, i) => {
    const m = (n.metadata || {}) as Record<string, unknown>;
    const parts = [
      `[${i + 1}] id=${n.id}`,
      `date=${new Date(n.created_at).toLocaleDateString()}`,
      `type=${m.type || n.entity_type || "unknown"}`,
    ];
    if (Array.isArray(m.topics) && m.topics.length) parts.push(`topics=${(m.topics as string[]).join(",")}`);
    if (Array.isArray(m.people) && m.people.length) parts.push(`people=${(m.people as string[]).join(",")}`);
    if (Array.isArray(m.action_items) && m.action_items.length) {
      const completed = Array.isArray(m.completed_actions) ? (m.completed_actions as string[]) : [];
      const open = (m.action_items as string[]).filter((a) => !completed.includes(a));
      if (open.length) parts.push(`open_actions=${open.join("; ")}`);
    }
    parts.push(`\n${String(n.content || "").substring(0, 500)}`);
    return parts.join(" | ");
  });

  const prompt = `Analyze these ${noteRows.length} notes captured over the past ${days} days by a single person. Return JSON with:

- "week_summary": 2-3 sentence overview of the week's themes and activity
- "themes": array of {name, note_count, synthesis} — the 3-5 dominant topics with a synthesis paragraph each
- "open_loops": array of {action_item, source_note_title, captured_date, urgency} — unresolved action items. urgency is "high", "medium", or "low"
- "connections": array of {note_title_1, note_title_2, connection_description} — non-obvious links between notes from different days/contexts
- "gaps": array of strings — what's conspicuously absent based on the person's apparent priorities
- "people_summary": array of {name, interaction_count, latest_context}
- "stats": {total_notes, by_type_counts (object of type->count), most_active_day (day name)}

Notes:
${noteSummaries.join("\n\n")}`;

  const { result: llmData, credits } = await openRouterWithCredits(
    supabaseAdmin,
    OPENROUTER_API_KEY,
    userId,
    "weekly-review:chat",
    "chat/completions",
    {
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
    },
  );

  let reviewData: Record<string, unknown>;
  try {
    reviewData = JSON.parse(llmData.choices[0].message.content);
  } catch {
    throw new Error("Failed to parse AI response");
  }

  const { data: savedReview, error: saveError } = await supabaseAdmin
    .from("weekly_reviews")
    .insert({
      user_id: userId,
      week_start: weekStart,
      week_end: weekEnd,
      review_data: reviewData,
    })
    .select("id, week_start, week_end, review_data, created_at")
    .single();

  if (saveError) throw new Error(saveError.message);

  if (options.scheduled) {
    await supabaseAdmin.from("notifications").insert({
      user_id: userId,
      type: "weekly_review_ready",
      title: "Your weekly review is ready",
      body: "Menerio analyzed your recent notes and found new patterns, open loops, and connections.",
      link: "/dashboard/review",
      metadata: { weekly_review_id: savedReview.id, week_start: weekStart, week_end: weekEnd },
    });
  }

  return {
    ...savedReview,
    saved: true,
    credits: { remaining_tokens: credits.remaining_tokens, remaining_credits: credits.remaining_credits },
  };
}

async function runScheduledWeeklyReviews(supabaseAdmin: any) {
  const { data: profiles, error } = await supabaseAdmin
    .from("profiles")
    .select("id");

  if (error) throw new Error(error.message);

  const { data: preferences } = await supabaseAdmin
    .from("notification_preferences")
    .select("user_id, notify_weekly_review");

  const preferencesByUser = new Map(
    (preferences || []).map((pref: { user_id: string; notify_weekly_review: boolean }) => [
      pref.user_id,
      pref.notify_weekly_review,
    ]),
  );

  const results = { processed: 0, created: 0, skipped: 0, errors: 0 };

  for (const profile of profiles || []) {
    if (preferencesByUser.get(profile.id) === false) {
      results.skipped++;
      continue;
    }

    try {
      const profileId = String(profile.id);
      const result = await createWeeklyReviewForUser(supabaseAdmin, profileId, 7, { scheduled: true });
      results.processed++;
      if ("saved" in result && result.saved) results.created++;
      if (result.skipped) results.skipped++;
    } catch (err) {
      results.errors++;
      console.error(`weekly-review scheduled error for ${profile.id}:`, err);
    }
  }

  return results;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    const body = await req.json().catch(() => ({}));
    const days = clampDays(body.days);
    const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    if (body.mode === "scheduled") {
      if (authHeader !== `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`) {
        return json({ error: "Unauthorized" }, 401);
      }

      const work = runScheduledWeeklyReviews(supabaseAdmin);
      EdgeRuntime.waitUntil(work);
      return json({ ok: true, scheduled: true, status: "processing" }, 202);
    }

    const user = await getAuthenticatedUser(authHeader);
    if (!user) {
      return json({ error: "Unauthorized" }, 401);
    }

    const result = await createWeeklyReviewForUser(supabaseAdmin, user.id, days);

    if (result.skipped === "insufficient_credits") {
      return insufficientCreditsResponse(corsHeaders);
    }

    return json(result);
  } catch (err) {
    if (err instanceof Error && (err.message === "INSUFFICIENT_CREDITS" || err.message === "NO_ACTIVE_PERIOD")) {
      return insufficientCreditsResponse(corsHeaders);
    }
    console.error("weekly-review error:", err);
    return json({ error: err instanceof Error ? err.message : "An unknown error occurred" }, 500);
  }
});
