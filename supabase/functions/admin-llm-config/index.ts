import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { runChat, type Provider } from "../_shared/llm-router.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

const PROVIDER_SECRETS: Record<Provider, string> = {
  lovable: "LOVABLE_API_KEY",
  openrouter: "OPENROUTER_API_KEY",
  openai: "OPENAI_API_KEY",
  anthropic: "ANTHROPIC_API_KEY",
  gemini: "GEMINI_API_KEY",
  mistral: "MISTRAL_API_KEY",
};

function providerAvailability(): Record<Provider, boolean> {
  const out = {} as Record<Provider, boolean>;
  for (const [p, env] of Object.entries(PROVIDER_SECRETS) as [Provider, string][]) {
    out[p] = !!Deno.env.get(env);
  }
  return out;
}

const PROCESS_NOTE_METADATA_PROMPT = `Extract metadata from the user's note. Return JSON with:
 - "title": If the first line of the note is 10 words or fewer and reads like a natural title or heading, use it verbatim. Otherwise, generate a concise title (max 8 words) that captures the essence of the note.
 - "people": array of people mentioned (empty if none)

 - "dates_mentioned": array of dates in YYYY-MM-DD format (empty if none)
 - "topics": array of 1-5 short topic tags (always generate at least one)
 - "type": one of "observation", "task", "idea", "reference", "person_note", "meeting_note", "decision", "project"
 - "sentiment": one of "positive", "negative", "neutral"
 - "summary": one-sentence summary of the note
Only extract what's explicitly there. Don't invent details.`;

const PROCESS_NOTE_PROFILE_PROMPT = `You are extracting biographical facts about specific real people from a personal note.

Return a JSON object with two keys:
1. "facts": an array of profile fact objects, each with:
   - "contact_name": the person's name exactly as provided
   - "category_slug": one of: identity, location, professional, education, relationships, communication, personality, principles, health, hobbies, food, entertainment, travel, digital, financial, goals, preferences
   - "label": a short label for the fact (e.g. "Favorite cuisine", "Current city", "Job title")
   - "value": the actual value (e.g. "Japanese", "Berlin", "Software Engineer")

2. "relationships": an array of relationship objects, each with:
   - "person_a": name of the first person
   - "person_b": name of the second person (can be "me" or "myself" if referring to the note author)
   - "label_a_to_b": what person_a is to person_b (e.g. "employee", "brother", "friend", "mentor")
   - "label_b_to_a": what person_b is to person_a

CRITICAL — DO NOT EXTRACT FACTS WHEN:
- The person appears only as the author / byline / source / "by X" / "via X" / link metadata of the content. Their name on a prompt, article, video, podcast, or document does NOT make the content's topic their personal attribute.
- The person is the subject of a third-party article, prompt template, course, product description, or job posting. The role described in the content belongs to the content, NOT to the person.
- The note is a prompt library, template, documentation, code snippet, or generic reference rather than a first-person observation about the person.
- A fact would be inferred only from indirect mentions, quotes, or generic context.

Only extract a Job title / Company / Current city / etc. when the note text contains an EXPLICIT first-person-style statement: "X is a Y", "X works as Y at Z", "X lives in Y", "X's role is Y", "I met X who is a Y". Vague mentions, authorship, and topic descriptions do NOT qualify.

Examples:
- ✓ "Nate works as a knowledge architect at Acme." → {contact_name: "Nate", category_slug: "professional", label: "Job title", value: "knowledge architect at Acme"}
- ✗ "OB1-Wiki Prompt 3: Wiki Synthesis Agent — by Nate Jones" → no facts. Nate is the author; "Wiki Synthesis Agent" is the prompt's role, not Nate's job.
- ✗ "Karpathy's tutorial on transformers" → no facts. The note is about a tutorial, not Karpathy's biography.

Rules:
- Only extract facts/relationships clearly stated about the person themselves
- Do NOT invent or assume
- Skip vague, third-party, or authorship-only mentions
- Return empty arrays if nothing qualifies
- For relationships, use standard labels: employee, employer, friend, brother, sister, mother, father, son, daughter, partner, spouse, mentor, mentee, manager, report, co-worker, neighbor, roommate, client, provider, teacher, student

DERIVED FACTS — compute the canonical underlying fact when the note gives you enough to do so safely:
- If the note states an age AND a reference date (explicit "on YYYY-MM-DD" in the text, or unambiguously from the provided Note date), compute the date of birth:
    label = "Date of birth", value = "YYYY-MM-DD" where year = referenceYear - age, month/day from the reference date.
- If the note states a wedding anniversary in the same shape, derive label = "Anniversary", value = "YYYY-MM-DD".
- If you cannot derive an exact ISO date confidently, do NOT emit a Birthday/Anniversary fact at all — never store free text like "61st birthday on 2026-05-25" as a value.
- Always normalize date values to ISO YYYY-MM-DD.

Derived-fact examples:
- Note text "Gunther turned 61 on 2026-05-25." → {contact_name: "Gunther", category_slug: "identity", label: "Date of birth", value: "1965-05-25"}
- Note text "Anna's 30th birthday was on 2024-03-12." → {label: "Date of birth", value: "1994-03-12"}
- Note text "Tom is 40 years old" with Note date 2026-01-10 and no explicit birthday date → DO NOT emit a Date of birth (we don't know month/day).`;

const JSON_OBJECT_OPTIONS = { response_format: { type: "json_object" } };

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Unauthorized" }, 401);

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );
    const userClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return json({ error: "Unauthorized" }, 401);

    const { data: isAdminRow } = await admin.rpc("is_admin", { _user_id: user.id });
    if (!isAdminRow) return json({ error: "Forbidden — admin only" }, 403);

    const body = await req.json().catch(() => ({}));
    const action = body.action as string;

    if (action === "list") {
      const { data: rows, error } = await admin
        .from("llm_call_configs")
        .select("*")
        .order("call_site");
      if (error) throw error;
      return json({
        configs: rows ?? [],
        availability: providerAvailability(),
      });
    }

    if (action === "test") {
      const callSite = String(body.call_site || "");
      const userPrompt = String(body.prompt || "Sag 'Hallo' und nenne das Modell und den Provider, den du nutzt.");
      if (!callSite) return json({ error: "call_site required" }, 400);

      const { data: row, error } = await admin
        .from("llm_call_configs")
        .select("*")
        .eq("call_site", callSite)
        .maybeSingle();
      if (error) throw error;
      if (!row) return json({ error: "Unknown call_site" }, 404);

      // OCR endpoint is not a chat endpoint — surface a clear notice instead of failing.
      if (typeof row.model === "string" && row.model.includes("ocr")) {
        return json({
          ok: false,
          error: "OCR-Endpoint can't be tested via chat. Trigger via real PDF/image upload to verify.",
          provider: row.provider,
          model: row.model,
        });
      }

      const startedAt = Date.now();
      try {
        const result = await runChat({
          db: admin,
          userId: user.id,
          callSite,
          messages: [{ role: "user", content: userPrompt }],
          defaults: { provider: row.provider, model: row.model },
        });
        return json({
          ok: true,
          provider: result.provider,
          model: result.model,
          content: result.content,
          config_source: result.configSource,
          latency_ms: Date.now() - startedAt,
          credits: result.credits,
        });
      } catch (err) {
        return json({
          ok: false,
          error: (err as Error).message,
          latency_ms: Date.now() - startedAt,
        }, 200);
      }
    }

    return json({ error: "Unknown action" }, 400);
  } catch (err) {
    console.error("admin-llm-config error:", err);
    return json({ error: (err as Error).message }, 500);
  }
});
