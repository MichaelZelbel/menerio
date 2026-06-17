import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { insufficientCreditsResponse } from "../_shared/llm-credits.ts";
import { runChat } from "../_shared/llm-router.ts";
import { GENERATE_PROFILE_SUGGESTIONS_PROMPT } from "../_shared/llm-defaults.ts";

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

    // Load owner identity (display name + self aliases) — mirrors process-note's loadSelfContext
    let ownerPreferredName: string | null = null;
    const ownerAliases = new Set<string>();
    let selfMatchingEnabled = true;
    {
      const { data: profile } = await db
        .from("profiles")
        .select("display_name, self_matching_enabled")
        .eq("id", userId)
        .maybeSingle();
      if (profile) {
        selfMatchingEnabled = (profile as any).self_matching_enabled !== false;
        const dn = ((profile as any).display_name || "").trim();
        if (dn) {
          ownerPreferredName = dn;
          ownerAliases.add(dn.toLowerCase());
          const first = dn.split(/\s+/)[0];
          if (first) ownerAliases.add(first.toLowerCase());
        }
      }
      if (selfMatchingEnabled) {
        const { data: aliasRows } = await db
          .from("user_self_aliases")
          .select("alias, is_active")
          .eq("user_id", userId)
          .eq("is_active", true);
        for (const r of (aliasRows || []) as any[]) {
          const a = String(r.alias || "").trim().toLowerCase();
          if (a) ownerAliases.add(a);
        }
      }
    }
    const ownerDisplay = ownerPreferredName || "the profile owner";
    const aliasList = Array.from(ownerAliases);
    const aliasesText = aliasList.length ? aliasList.join(", ") : "(none provided)";

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
      .eq("ai_visibility", "visible")
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

    const prompt = `You are analyzing a user's personal notes to suggest profile entries for the OWNER'S OWN personal profile.

PROFILE OWNER
The profile owner is: ${ownerDisplay}
Also known as (aliases): ${aliasesText}
You are building ONLY this owner's own personal profile — not a profile for anyone else mentioned in the notes.

STRICT SUBJECT-ATTRIBUTION RULES (must follow):
- ONLY suggest a fact when the note text makes a first-person statement about the OWNER themselves ("I am…", "I'm…", "my…", "I have…", "I live in…", "I work as…"), OR an explicit statement about the owner by their own name/alias above.
- NEVER suggest a fact that describes someone else — a contact, partner, family member, friend, colleague, VRChat persona/alt, or any third party mentioned in the notes. Facts about other people belong to THOSE people, not the owner.
- The "Top people mentioned" list below names OTHER people in the owner's notes. It is context about who the owner knows — it is NOT a source of the owner's own attributes. Do not turn a mentioned person's traits, job, location, health, or relationships into the owner's profile entries.
- If you cannot tell whether a fact is about the owner or about someone else, DO NOT suggest it. When in doubt, leave it out.
- Do not infer the owner's identity, relationships, health, or location from facts stated about other people (e.g. a contact having a spouse does not mean the owner has one).

EXAMPLES
✓ Note says: "I'm a backend engineer at Acme based in Berlin." → suggest professional/location entries for the owner.
✗ Note says: "Alex is my dentist and lives in Munich." → do NOT suggest "lives in Munich" for the owner (that's Alex). You also should not suggest "dentist: Alex" as an owner attribute unless an explicit owner-facing field calls for it.
✗ Note titled "Xihui" describing that person's job, hobbies, or partner → do NOT turn any of those into owner profile entries.

PROFILE CATEGORIES (by slug) available on this profile: ${categorySlugs.join(", ")}

Default category slugs and what they cover:
- identity: Name, pronouns, languages, nationality
- location: Current city, timezone, living situation
- professional: Job, company, industry, skills
- education: Degrees, certifications
- relationships: Partners, children, close family — the owner may have multiple partners; never assume only one, and only record relationships first-person about the owner
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

DATA FROM THE USER'S NOTES (mostly describes OTHER people and topics — apply the attribution rules above):

Top topics: ${topTopics.join(", ") || "none"}

Top people mentioned (these are OTHER people, NOT the owner): ${topPeople.join(", ") || "none"}

Note types: ${entitySummary.join(", ") || "none"}

Total notes: ${notes.length}

Sample note snippets:
${sampleSnippets.join("\n---\n")}

Existing profile entries (DO NOT duplicate these):
${existingLabels.join("\n") || "none yet"}

Based on these patterns, suggest profile entries the OWNER might want to add to their OWN profile. For each suggestion provide:
- category_slug (from the list above)
- label (short field name)
- value (suggested value)
- confidence: "high", "medium", or "low"
- reason: brief explanation, including which note text made this clearly about the owner

Only suggest things you're reasonably confident are about the OWNER. Return 5-15 suggestions max (fewer is fine — return an empty array if nothing in the notes clearly describes the owner). Return valid JSON array.`;

    const chatResult = await runChat({
      db,
      userId,
      callSite: "generate-profile-suggestions.main",
      messages: [{ role: "user", content: prompt }],
      defaults: {
        provider: "openrouter",
        model: "deepseek/deepseek-v4-flash",
        systemPrompt: GENERATE_PROFILE_SUGGESTIONS_PROMPT,
      },
      callOptions: { response_format: { type: "json_object" } },
    });
    const credits = chatResult.credits;

    let suggestions: any[] = [];
    try {
      const content = chatResult.content || "[]";
      const parsed = JSON.parse(content);
      suggestions = Array.isArray(parsed) ? parsed : (parsed.suggestions || parsed.entries || []);
    } catch {
      console.error("Failed to parse LLM response:", chatResult.content);
      suggestions = [];
    }

    // Filter out suggestions for categories the user doesn't have
    suggestions = suggestions.filter((s: any) =>
      s.category_slug && s.label && s.value && categorySlugs.includes(s.category_slug)
    );

    return new Response(JSON.stringify({
      suggestions,
      credits: credits ? { remaining_credits: credits.remaining_credits } : null,
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
