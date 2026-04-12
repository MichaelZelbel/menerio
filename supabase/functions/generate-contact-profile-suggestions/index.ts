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

    const { contact_id } = await req.json();
    if (!contact_id) {
      return new Response(JSON.stringify({ error: "contact_id is required" }), { status: 400, headers: corsHeaders });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const openrouterKey = Deno.env.get("OPENROUTER_API_KEY")!;
    const db = createClient(supabaseUrl, supabaseKey);

    // Auth
    const anonClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!);
    const { data: { user }, error: authErr } = await anonClient.auth.getUser(authHeader.replace("Bearer ", ""));
    if (authErr || !user) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: corsHeaders });
    const userId = user.id;

    // Get the contact
    const { data: contact, error: contactErr } = await db
      .from("contacts")
      .select("name, aliases, notes, tags, metadata")
      .eq("id", contact_id)
      .eq("user_id", userId)
      .single();

    if (contactErr || !contact) {
      return new Response(JSON.stringify({ error: "Contact not found" }), { status: 404, headers: corsHeaders });
    }

    const names = [contact.name, ...(contact.aliases || [])];

    // Get profile categories for this contact
    const { data: categories } = await db
      .from("profile_categories")
      .select("slug, name")
      .eq("user_id", userId)
      .eq("contact_id", contact_id);

    const categorySlugs = (categories || []).map((c: any) => c.slug);

    // Get related notes (notes mentioning this person)
    const { data: allNotes } = await db
      .from("notes")
      .select("id, title, content, tags, metadata, entity_type, created_at")
      .eq("user_id", userId)
      .eq("is_trashed", false)
      .order("created_at", { ascending: false })
      .limit(500);

    // Filter to notes mentioning this person
    const relatedNotes = (allNotes || []).filter((note: any) => {
      const people = note.metadata?.people as string[] | undefined;
      if (!people || !Array.isArray(people)) return false;
      return names.some((n: string) => people.some((p: string) => p.toLowerCase() === n.toLowerCase()));
    });

    if (relatedNotes.length === 0) {
      return new Response(JSON.stringify({
        suggestions: [],
        message: `No notes mention ${contact.name} yet.`,
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Get existing entries for this contact's profile
    const { data: existingEntries } = await db
      .from("profile_entries")
      .select("label, value, category_id")
      .eq("user_id", userId)
      .eq("contact_id", contact_id);

    const existingLabels = (existingEntries || []).map((e: any) => `${e.label}: ${e.value}`);

    // Build note snippets
    const noteSnippets = relatedNotes.slice(0, 20).map((n: any) => {
      const content = (n.content || "").substring(0, 400);
      return `[Note ID: ${n.id}] Title: ${n.title}\nSnippet: ${content}`;
    });

    // Aggregate topics from related notes
    const topicCounts: Record<string, number> = {};
    for (const note of relatedNotes) {
      if (note.tags) for (const tag of note.tags) topicCounts[tag] = (topicCounts[tag] || 0) + 1;
      const meta = note.metadata as any;
      if (meta?.topics) for (const t of meta.topics) topicCounts[t] = (topicCounts[t] || 0) + 1;
    }
    const topTopics = Object.entries(topicCounts).sort((a, b) => b[1] - a[1]).slice(0, 15).map(([t, c]) => `${t} (${c})`);

    const prompt = `You are analyzing notes about a person called "${contact.name}" (also known as: ${(contact.aliases || []).join(", ") || "no aliases"}).

The user has written ${relatedNotes.length} notes mentioning this person. Your job is to extract profile facts about ${contact.name} from these notes and suggest profile entries.

The profile uses these categories (by slug): ${categorySlugs.join(", ")}.

Category descriptions:
- identity: Name, pronouns, languages, nationality
- location: Current city, timezone, living situation
- professional: Job, company, industry, skills
- education: Degrees, certifications
- relationships: Partner, children, close family
- communication: Tone, humor style, preferred channels
- personality: Type indicators, core values
- principles: Personal rules, frameworks
- health: Medical, allergies, fitness
- hobbies: Active hobbies, creative pursuits
- food: Cuisines, dietary style
- entertainment: Genres, movies, books
- travel: Countries, bucket list
- digital: Social profiles, tools
- financial: Goals, investment style
- goals: Short-term, long-term goals
- preferences: Morning/night, likes/dislikes

CONTEXT ABOUT ${contact.name}:
Free-form notes: ${contact.notes || "none"}
Tags: ${(contact.tags || []).join(", ") || "none"}

TOPICS FROM RELATED NOTES: ${topTopics.join(", ") || "none"}

RELATED NOTE SNIPPETS:
${noteSnippets.join("\n---\n")}

EXISTING PROFILE ENTRIES (DO NOT duplicate):
${existingLabels.join("\n") || "none yet"}

Based on these notes, suggest profile entries for ${contact.name}. For each suggestion:
- category_slug (from the list above)
- label (short field name, e.g. "Favorite hobby", "Current city")
- value (the extracted fact)
- confidence: "high", "medium", or "low"
- reason: brief explanation citing which note(s) support this
- source_note_id: the note ID that most strongly supports this fact (from the [Note ID: ...] tags)

Only suggest things clearly supported by the notes. Return 3-12 suggestions max. Return valid JSON array.`;

    const { result, credits } = await chatWithCredits(
      db, openrouterKey, userId, "contact-profile-suggestions",
      [
        { role: "system", content: "You are a profile analyst for a person. Return ONLY a JSON array of suggestion objects. No markdown, no explanation outside the JSON." },
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

    // Validate
    suggestions = suggestions.filter((s: any) =>
      s.category_slug && s.label && s.value && categorySlugs.includes(s.category_slug)
    );

    return new Response(JSON.stringify({
      suggestions,
      credits: { remaining_credits: credits.remaining_credits },
      analyzed_notes: relatedNotes.length,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: any) {
    console.error("generate-contact-profile-suggestions error:", err);
    if (err.message === "INSUFFICIENT_CREDITS") {
      return insufficientCreditsResponse(corsHeaders);
    }
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
