import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { chatWithCredits, insufficientCreditsResponse } from "../_shared/llm-credits.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: corsHeaders });

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const openrouterKey = Deno.env.get("OPENROUTER_API_KEY")!;
    const db = createClient(supabaseUrl, supabaseKey);

    // Get user from JWT
    const anonClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!);
    const { data: { user }, error: authErr } = await anonClient.auth.getUser(authHeader.replace("Bearer ", ""));
    if (authErr || !user) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: corsHeaders });
    const userId = user.id;

    // Get existing categories for the user
    const { data: categories } = await db
      .from("profile_categories")
      .select("slug, name")
      .eq("user_id", userId);

    const categorySlugs = (categories || []).map((c: any) => c.slug);

    // Gather note intelligence
    // 1. Get all notes metadata
    const { data: notes } = await db
      .from("notes")
      .select("title, content, tags, metadata, entity_type, created_at")
      .eq("user_id", userId)
      .eq("is_trashed", false)
      .order("created_at", { ascending: false })
      .limit(500);

    if (!notes || notes.length < 5) {
      return new Response(JSON.stringify({
        suggestions: [],
        message: "Not enough notes to generate suggestions. Write at least 5 notes first."
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // 2. Aggregate topics
    const topicCounts: Record<string, number> = {};
    const peopleMentions: Record<string, number> = {};
    const entityTypes: Record<string, number> = {};

    for (const note of notes) {
      // Tags as topics
      if (note.tags) {
        for (const tag of note.tags) {
          topicCounts[tag] = (topicCounts[tag] || 0) + 1;
        }
      }
      // Metadata topics
      const meta = note.metadata as any;
      if (meta?.topics) {
        for (const t of meta.topics) {
          topicCounts[t] = (topicCounts[t] || 0) + 1;
        }
      }
      // People
      if (meta?.people) {
        for (const p of meta.people) {
          peopleMentions[p] = (peopleMentions[p] || 0) + 1;
        }
      }
      // Entity types
      if (note.entity_type) {
        entityTypes[note.entity_type] = (entityTypes[note.entity_type] || 0) + 1;
      }
    }

    const topTopics = Object.entries(topicCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 20)
      .map(([topic, count]) => `${topic} (${count} notes)`);

    const topPeople = Object.entries(peopleMentions)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([person, count]) => `${person} (${count} mentions)`);

    const entitySummary = Object.entries(entityTypes)
      .sort((a, b) => b[1] - a[1])
      .map(([type, count]) => `${type}: ${count}`);

    // 3. Random sample of note snippets
    const shuffled = [...notes].sort(() => Math.random() - 0.5);
    const sampleSnippets = shuffled.slice(0, 15).map((n: any) => {
      const content = (n.content || "").substring(0, 300);
      return `Title: ${n.title}\nSnippet: ${content}`;
    });

    // 4. Get existing entries to avoid duplicates
    const { data: existingEntries } = await db
      .from("profile_entries")
      .select("label, value, category_id")
      .eq("user_id", userId);

    const existingLabels = (existingEntries || []).map((e: any) => `${e.label}: ${e.value}`);

    const prompt = `You are analyzing a user's personal notes to suggest profile entries they might want to add to their personal profile. The profile has these categories (by slug): ${categorySlugs.join(", ")}.

Here are the default category slugs and what they cover:
- identity: Name, pronouns, languages, nationality
- location: Current city, timezone, living situation
- professional: Job, company, industry, skills
- education: Degrees, certifications
- relationships: Partner, children, close family
- communication: Tone, humor style
- personality: Type indicators, core values
- principles: Personal rules, codex vitae
- health: Medical, allergies, fitness
- hobbies: Active hobbies, creative pursuits
- food: Cuisines, dietary style
- entertainment: Genres, movies, books
- travel: Countries, bucket list
- digital: Social profiles, tools, tech stack
- financial: Goals, investment style
- goals: Short-term, long-term goals
- preferences: Morning/night, introvert/extrovert

DATA FROM THE USER'S NOTES:

Top topics: ${topTopics.join(", ") || "none"}

Top people mentioned: ${topPeople.join(", ") || "none"}

Note types: ${entitySummary.join(", ") || "none"}

Total notes: ${notes.length}

Sample note snippets:
${sampleSnippets.join("\n---\n")}

Existing profile entries (DO NOT duplicate these):
${existingLabels.join("\n") || "none yet"}

Based on these patterns, suggest profile entries the user might want to add. For each suggestion provide:
- category_slug (from the list above)
- label (short field name)
- value (suggested value)
- confidence: "high", "medium", or "low"
- reason: brief explanation of why you suggest this

Only suggest things you're reasonably confident about. Return 5-15 suggestions max. Return valid JSON array.`;

    const { result, credits } = await chatWithCredits(
      db, openrouterKey, userId, "profile-suggestions",
      [
        { role: "system", content: "You are a profile analyst. Return ONLY a JSON array of suggestion objects. No markdown, no explanation outside the JSON." },
        { role: "user", content: prompt },
      ],
      { response_format: { type: "json_object" } }
    );

    let suggestions: any[] = [];
    try {
      const content = result.choices?.[0]?.message?.content || "[]";
      const parsed = JSON.parse(content);
      suggestions = Array.isArray(parsed) ? parsed : (parsed.suggestions || parsed.entries || []);
    } catch {
      console.error("Failed to parse LLM response:", result.choices?.[0]?.message?.content);
      suggestions = [];
    }

    // Filter out suggestions for categories the user doesn't have
    suggestions = suggestions.filter((s: any) =>
      s.category_slug && s.label && s.value && categorySlugs.includes(s.category_slug)
    );

    return new Response(JSON.stringify({
      suggestions,
      credits: { remaining_credits: credits.remaining_credits },
      analyzed_notes: notes.length,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: any) {
    console.error("generate-profile-suggestions error:", err);
    if (err.message === "INSUFFICIENT_CREDITS") {
      return insufficientCreditsResponse(corsHeaders);
    }
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
