import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { runChat } from "../_shared/llm-router.ts";
import {
  canonicalProfileLabel,
  matchProfileCategoryByLabel,
  CANONICAL_LABELS_FOR_PROMPT,
} from "../_shared/profile-canonical-schema.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// The 17-slug taxonomy — the HARD storage contract shared with the extraction
// pipeline (mirrors src/lib/profile-taxonomy.ts and _shared/
// profile-normalization.ts's PROFILE_CATEGORY_SLUGS). Names mirror the client
// PROFILE_TAXONOMY so the proposal chip reads identically on both sides.
const CATEGORY_NAMES: Record<string, string> = {
  identity: "Identity & Basics",
  location: "Location & Living",
  professional: "Professional Life",
  education: "Education",
  relationships: "Relationships & Family",
  communication: "Communication Style",
  personality: "Personality & Values",
  principles: "Principles & Operating System",
  health: "Health & Wellness",
  hobbies: "Hobbies & Interests",
  food: "Food & Drink",
  entertainment: "Music & Entertainment",
  travel: "Travel & Experiences",
  digital: "Digital Life",
  financial: "Financial",
  goals: "Goals & Aspirations",
  preferences: "Preferences & Quirks",
};
const CATEGORY_SLUGS = Object.keys(CATEGORY_NAMES);
// Invalid/unknown slugs are never dropped — the user sees the chip and can
// re-file, so a safe open category is the fallback home.
const FALLBACK_SLUG = "preferences";

// `{{contactName}}` is interpolated by the llm-router (templateVars). Kept as a
// module constant so an admin can override it per call-site via llm_call_configs
// while still receiving the contact name.
const SYSTEM_PROMPT = [
  `You file a single short fact about a person named "{{contactName}}" into exactly one profile category.`,
  ``,
  `Allowed category_slug values (choose STRICTLY one of these 17):`,
  CATEGORY_SLUGS.join(", "),
  ``,
  `Canonical labels for the structured categories (prefer these EXACT labels when the fact fits one; other categories are open — use a short natural label):`,
  CANONICAL_LABELS_FOR_PROMPT,
  ``,
  `Rules:`,
  `- Split the fact into a short "label" (the attribute — a few words) and a "value" (the detail), unless a label and value are already given, in which case keep them.`,
  `- Prefer a canonical label for structured categories; keep a concise natural label for open categories.`,
  `- category_slug MUST be exactly one of the 17 slugs listed above.`,
  `- Return ONLY a JSON object: {"label": string, "value": string, "category_slug": string, "confidence": number between 0 and 1}. No prose, no markdown.`,
].join("\n");

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Unauthorized" }, 401);

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;

    const db = createClient(SUPABASE_URL, SERVICE_ROLE);
    const anonClient = createClient(SUPABASE_URL, ANON);
    const { data: { user }, error: authErr } = await anonClient.auth.getUser(
      authHeader.replace("Bearer ", ""),
    );
    if (authErr || !user) return json({ error: "Unauthorized" }, 401);
    const userId = user.id;

    const body = await req.json().catch(() => ({}));
    const contactId = String(body?.contact_id || "").trim();
    if (!contactId) return json({ error: "contact_id required" }, 400);

    const rawText = typeof body?.text === "string" ? body.text.trim() : "";
    const rawLabel = typeof body?.label === "string" ? body.label.trim() : "";
    const rawValue = typeof body?.value === "string" ? body.value.trim() : "";

    const hasLabelValue = rawLabel.length > 0 && rawValue.length > 0;
    if (!hasLabelValue && !rawText) {
      return json({ error: "Provide a fact — either free text or a label and value." }, 400);
    }

    // Ownership check (scoped to the authed user) — also fetches the name the
    // LLM prompt needs. Blocks classifying facts for someone else's contact.
    const { data: contact, error: contactErr } = await db
      .from("contacts")
      .select("name")
      .eq("id", contactId)
      .eq("user_id", userId)
      .maybeSingle();
    if (contactErr) return json({ error: "Failed to load contact." }, 500);
    if (!contact) return json({ error: "Contact not found" }, 404);
    const contactName = String((contact as { name?: string }).name || "this person");

    // --- Deterministic pre-pass: a label+value with a known structured label
    // resolves without an LLM call (fast + free). ---
    if (hasLabelValue) {
      const match = matchProfileCategoryByLabel(rawLabel);
      if (match) {
        const slug = CATEGORY_SLUGS.includes(match.slug) ? match.slug : FALLBACK_SLUG;
        return json({
          label: canonicalProfileLabel(slug, rawLabel) || rawLabel,
          value: rawValue,
          category_slug: slug,
          category_name: CATEGORY_NAMES[slug],
          confidence: 0.95,
          source: "deterministic",
        });
      }
    }

    // --- LLM pass: freeform text, or a label+value with no deterministic rule. ---
    const userContent = hasLabelValue
      ? `Label: ${rawLabel}\nValue: ${rawValue}`
      : `Fact: ${rawText}`;

    let parsed: Record<string, unknown> = {};
    try {
      const result = await runChat({
        db,
        userId,
        callSite: "classify-profile-fact",
        messages: [{ role: "user", content: userContent }],
        defaults: {
          provider: "openrouter",
          model: "deepseek/deepseek-v4-flash",
          systemPrompt: SYSTEM_PROMPT,
          temperature: 0.1,
        },
        callOptions: { response_format: { type: "json_object" } },
        templateVars: { contactName },
      });
      parsed = JSON.parse(result.content);
    } catch (err) {
      console.error("[classify-profile-fact] LLM call failed:", err);
      return json({ error: "Could not classify this fact. Please try again." }, 502);
    }

    let label = String(parsed?.label ?? (hasLabelValue ? rawLabel : "")).trim();
    const value = String(parsed?.value ?? (hasLabelValue ? rawValue : "")).trim();
    let slug = String(parsed?.category_slug ?? "").trim();
    const confidence = typeof parsed?.confidence === "number" ? parsed.confidence : 0.6;

    // Slug outside the 17-slug contract → never drop; file under the fallback.
    if (!CATEGORY_SLUGS.includes(slug)) slug = FALLBACK_SLUG;
    // Prefer the canonical label for structured categories.
    label = canonicalProfileLabel(slug, label) || label;

    if (!label || !value) {
      return json(
        { error: "Could not read a clear label and value from that. Try \"label: value\"." },
        400,
      );
    }

    return json({
      label,
      value,
      category_slug: slug,
      category_name: CATEGORY_NAMES[slug],
      confidence,
      source: "llm",
    });
  } catch (err) {
    console.error("[classify-profile-fact] handler error:", err);
    return json({ error: String(err) }, 500);
  }
});
