// Shared pipeline that turns a timeline `moment` (with participants) into
// `add_profile_entry` and `add_relationship` review_queue suggestions, reusing
// the same prompt + auto-apply thresholds as the note-based extractor in
// `process-note/index.ts`. Designed to be called from both the live edge
// function (`extract-moment-profile`) and the backfill function
// (`backfill-moment-profile-extraction`).

import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { checkBalance } from "./llm-credits.ts";
import { runChat } from "./llm-router.ts";
import {
  canonicalLabel,
  inverseLabel,
  isSymmetricLabel,
  relationshipPairKey,
  buildSelfAliases,
  isSelfName,
  type EntityRef,
} from "./relationship-canonical.ts";
import { profileValueDecision, relationshipWriteDecision } from "./profile-integrity.ts";

import { buildProfileTokenIndex, dedupIncomingProfileValue } from "./profile-dedup.ts";

const PROFILE_CATEGORY_SLUGS = [
  "identity", "location", "professional", "education", "relationships",
  "communication", "personality", "principles", "health", "hobbies",
  "food", "entertainment", "travel", "digital", "financial", "goals", "preferences",
];

const SENSITIVITY_THRESHOLDS: Record<string, number> = {
  conservative: 0.85,
  balanced: 0.7,
  exploratory: 0.55,
};

const AUTO_APPLY_THRESHOLDS: Record<string, Record<string, number>> = {
  add_profile_entry: { conservative: 0.78, balanced: 0.65, exploratory: 0.5 },
  add_relationship: { conservative: 0.80, balanced: 0.7, exploratory: 0.55 },
};

const DEFAULT_CONFIDENCE: Record<string, number> = {
  add_profile_entry: 0.80,
  add_relationship: 0.72,
};

// Moments without document provenance can't be fully trusted (often free-form
// user input), so cap confidence to force user review under conservative.
// Lowered from 0.7 → 0.6 so manual moments never auto-apply at balanced (0.65).
const MANUAL_MOMENT_CONFIDENCE_CAP = 0.6;

// Labels that the LLM is allowed to emit, grouped by category slug. Anything
// outside this allowlist is dropped post-LLM. Lowercase, normalized.
const ALLOWED_PROFILE_LABELS: Record<string, string[]> = {
  identity: ["date of birth", "pronouns", "nationality", "languages", "full name", "nickname"],
  location: ["current city", "current country", "hometown", "home address", "neighborhood"],
  professional: ["job title", "company", "employer", "industry", "started role", "previous company", "previous job title"],
  education: ["school", "university", "degree", "field of study", "graduation year"],
  relationships: ["partner", "spouse", "children", "siblings", "parents"],
  communication: ["preferred channel", "email", "phone", "timezone"],
  personality: ["traits", "communication style"],
  principles: ["values", "beliefs"],
  health: ["allergies", "dietary restrictions", "conditions"],
  hobbies: ["hobbies", "interests", "sports"],
  food: ["favorite cuisine", "dietary preference", "favorite restaurant", "allergies"],
  entertainment: ["favorite music", "favorite movies", "favorite books", "favorite shows"],
  travel: ["bucket list", "visited countries", "favorite destination"],
  digital: ["website", "github", "linkedin", "twitter", "instagram"],
  financial: ["currency"],
  goals: ["short-term goals", "long-term goals"],
  preferences: ["gift preferences", "coffee order", "drink preference"],
};

const ALLOWED_LABEL_SET = new Set<string>(
  Object.values(ALLOWED_PROFILE_LABELS).flat().map((l) => l.toLowerCase()),
);

// Verbs that signal a one-time activity/event rather than an ongoing attribute.
const EVENT_ONLY_VERBS = [
  "adds", "added", "posts", "posted", "mentions", "mentioned", "tags", "tagged",
  "likes", "liked", "comments", "commented", "replies", "replied",
  "shares", "shared", "follows", "followed", "dms", "dmed",
  "messages", "messaged", "texts", "texted", "calls", "called",
  "visits", "visited", "meets", "met", "hangs", "hung",
  "sees", "saw", "watched", "played", "attended", "pings", "pinged",
];

// Phrases that mean an ongoing biographical fact IS being asserted, even if
// the title also has an event-like verb. If any match → don't pre-filter.
const BIO_MARKERS = [
  "moved to", "moves to", "lives in", "now lives", "works at", "now works",
  "joined", "promoted to", "promotion to", "married", "got married", "engaged",
  "divorced", "born on", "birthday", "graduated", "founded", "co-founded",
  "started at", "left ", "hired at", "relocated to",
];

function isLikelyEventOnlyMoment(title: string, description: string | null | undefined): boolean {
  const t = (title || "").toLowerCase();
  const d = (description || "").toLowerCase();
  const combined = `${t} ${d}`;
  if (BIO_MARKERS.some((m) => combined.includes(m))) return false;
  const verbRegex = new RegExp(`\\b(${EVENT_ONLY_VERBS.join("|")})\\b`, "i");
  return verbRegex.test(t);
}

function valueAppearsInSource(value: string, label: string, source: string): boolean {
  const v = value.toLowerCase().trim();
  const s = source.toLowerCase();
  if (!v) return false;
  // Date of birth: require the ISO date components to appear VERBATIM in the
  // source (as ISO or as a natural date with the same year+month+day).
  // No more "any ISO if source mentions birthday/born" — that let a stray
  // "born" plus a nearby year produce fabricated birthdays.
  if (label.toLowerCase() === "date of birth" && /^\d{4}-\d{2}-\d{2}$/.test(v)) {
    const [y, m, d] = v.split("-");
    if (s.includes(v)) return true; // ISO substring
    const monthNames = ["january","february","march","april","may","june","july","august","september","october","november","december","jan","feb","mar","apr","jun","jul","aug","sep","sept","oct","nov","dec"];
    const dayNum = String(Number(d));
    const monthIdx = Number(m) - 1;
    if (monthIdx >= 0 && monthIdx < 12) {
      // Require year + month name + day-of-month all present.
      const monthHits = monthNames.filter((mn) => s.includes(mn));
      if (
        s.includes(y) &&
        monthHits.some((mn) => (mn.startsWith(["jan","feb","mar","apr","may","jun","jul","aug","sep","oct","nov","dec"][monthIdx]))) &&
        new RegExp(`\\b${dayNum}(st|nd|rd|th)?\\b`).test(s)
      ) return true;
    }
    return false;
  }
  if (s.includes(v)) return true;
  // Fuzzy: ≥80% of value tokens (len ≥ 3) appear in source.
  const tokens = v.split(/\s+/).filter((tok) => tok.length >= 3);
  if (tokens.length === 0) return false;
  const hits = tokens.filter((tok) => s.includes(tok)).length;
  return hits / tokens.length >= 0.8;
}

const SENSITIVE_TERMS = [
  "medical", "health", "diagnosis", "condition", "therapy", "depression", "anxiety", "mental",
  "pregnant", "pregnancy", "romantic", "sexual", "affair", "secret", "conflict", "legal", "lawsuit",
  "debt", "bankrupt", "financial hardship", "broke", "divorce", "addiction", "trauma",
];

// SINGLETON_PROFILE_LABELS removed — the shared token-aware dedup guard
// in `profile-dedup.ts` now enforces singleton behavior via the canonical
// schema's `single: true` flag.


const MOMENT_PROFILE_EXTRACTION_PROMPT = `You are extracting biographical facts about specific real people from a personal life-timeline "moment" (an event or milestone the user recorded).

The moment has a title, optional description, a date, optional category, and a list of named participants (people who were involved).

Return a JSON object with two keys:
1. "facts": an array of profile fact objects, each with:
   - "contact_name": the person's name exactly as provided
   - "category_slug": one of: ${PROFILE_CATEGORY_SLUGS.join(", ")}
   - "label": MUST be one of the allowed labels listed below for the chosen category. Pick the closest match. If none fits, skip the fact.
   - "value": the actual value (e.g. "Lisbon", "Head of Design at Notion", "1990-05-12")

Allowed labels per category (lowercase, use exactly these strings):
${Object.entries(ALLOWED_PROFILE_LABELS).map(([k, v]) => `- ${k}: ${v.join(", ")}`).join("\n")}

2. "relationships": an array of relationship objects, each with:
   - "person_a", "person_b" ("me"/"myself" if author)
   - "label_a_to_b", "label_b_to_a"

HARD RULES (violations cause the fact to be dropped):
- The "value" MUST appear verbatim (case-insensitive) somewhere in the moment title or description, OR be an ISO date computed from an explicit Nth-birthday phrase. If you cannot point to the exact substring, return an empty facts array.
- The "label" MUST be from the allowed list above.
- If the moment describes a one-time action by or about a participant (verbs like: adds, posts, tags, mentions, likes, comments, messages, called, visited, met, hung out, watched, played, attended, shared, followed, replied), return empty arrays UNLESS the same moment ALSO contains an explicit ongoing-attribute clause (e.g. "Tom, now Head of Design at Notion, posted ...").
- Do not invent attributes that are merely plausible. Only extract what is explicitly stated.

DO EXTRACT clear personal facts the moment establishes about a named participant. Examples that QUALIFY:
- "Sarah moved to Lisbon" with Sarah → {contact_name: "Sarah", category_slug: "location", label: "current city", value: "Lisbon"}
- "Tom's promotion to Head of Design at Notion" → {contact_name: "Tom", category_slug: "professional", label: "job title", value: "Head of Design at Notion"}
- "Anna's 30th birthday" on 2024-03-12 → {contact_name: "Anna", category_slug: "identity", label: "date of birth", value: "1994-03-12"}
- "Karim and Lina got married" → relationship {person_a: "Karim", person_b: "Lina", label_a_to_b: "spouse", label_b_to_a: "spouse"}

Examples that DO NOT QUALIFY (return empty arrays):
- "Yumei adds Michael to her Discord banner" → {facts: [], relationships: []}
- "Tom posted about his vacation" → {facts: [], relationships: []}
- "Anna tagged me in a photo" → {facts: [], relationships: []}
- "Karim mentioned Lina in his story" → {facts: [], relationships: []}
- "Coffee with Sarah" → {facts: [], relationships: []}
- "Sarah visited Paris" → not a profile fact (one-time activity).

Rules:
- For dates of birth: if the moment is an Nth birthday with an explicit date, compute year = year(date) - N and emit ISO YYYY-MM-DD.
- For relationships, use standard labels: employee, employer, friend, brother, sister, mother, father, son, daughter, partner, spouse, mentor, mentee, manager, report, co-worker, neighbor, roommate, client, provider, teacher, student.
- Return empty arrays if nothing qualifies.`;

type Suggestion = {
  user_id: string;
  source_note_id: string | null;
  suggestion_type: string;
  title: string;
  description: string;
  payload: Record<string, unknown>;
  status: string;
  target_entity_type?: string | null;
  target_entity_id?: string | null;
  source_title?: string | null;
  extracted_value?: string | null;
  confidence_score?: number | null;
  is_sensitive?: boolean;
  applied_at?: string | null;
  suppression_key?: string | null;
};

function normalize(v: unknown) {
  return String(v || "").trim().toLowerCase().replace(/\s+/g, " ");
}

function buildSuppressionKey(type: string, targetType: string | null, targetId: string | null, value: unknown) {
  return [type, targetType || "none", targetId || "none", normalize(value)].join(":");
}

function isSensitive(type: string, payload: Record<string, unknown>, text = "") {
  const hay = `${type} ${text} ${Object.values(payload).join(" ")}`.toLowerCase();
  return SENSITIVE_TERMS.some((t) => hay.includes(t));
}

function thresholdFor(type: string, sensitivity: string): number {
  const perType = AUTO_APPLY_THRESHOLDS[type];
  if (perType && perType[sensitivity] !== undefined) return perType[sensitivity];
  return SENSITIVITY_THRESHOLDS[sensitivity] ?? SENSITIVITY_THRESHOLDS.balanced;
}

async function getPrefs(supabase: SupabaseClient, userId: string) {
  const { data } = await supabase
    .from("ai_suggestion_preferences")
    .select("suggestion_mode, suggestion_sensitivity, auto_add_sensitive")
    .eq("user_id", userId)
    .maybeSingle();
  return {
    mode: (data as any)?.suggestion_mode || "auto",
    sensitivity: (data as any)?.suggestion_sensitivity || "balanced",
    autoAddSensitive: (data as any)?.auto_add_sensitive === true,
  };
}

async function prepareForInsert(
  supabase: SupabaseClient,
  s: Suggestion,
  prefs: { mode: string; sensitivity: string; autoAddSensitive: boolean },
): Promise<Suggestion> {
  const threshold = thresholdFor(s.suggestion_type, prefs.sensitivity);
  const confidence = s.confidence_score ?? 0;
  // Extra guard: Date of birth is a permanent single-value fact and one wrong
  // auto-applied value stains a profile until manually fixed. Require ≥0.9
  // confidence regardless of user's sensitivity setting; otherwise route to
  // review.
  const isDob =
    s.suggestion_type === "add_profile_entry" &&
    String((s.payload as any)?.label || "").trim().toLowerCase() === "date of birth";
  if (isDob && confidence < 0.9) return { ...s, status: "pending_review" };
  const canAuto = prefs.mode === "auto" && confidence >= threshold && (!s.is_sensitive || prefs.autoAddSensitive);
  if (!canAuto) return { ...s, status: "pending_review" };

  try {
    if (s.suggestion_type === "add_profile_entry") {
      const contactId = s.payload.contact_id as string | undefined;
      const categoryId = s.payload.category_id as string | null | undefined;
      const label = String(s.payload.label || "").trim();
      const value = String(s.payload.value || "").trim();
      if (!contactId || !categoryId || !label || !value) return { ...s, status: "pending_review" };
      const fact = profileValueDecision(String(s.payload.category_slug || ""), label, value);
      if (!fact.ok) return { ...s, status: "removed" };
      const { data, error } = await supabase
        .from("profile_entries")
        .insert({ user_id: s.user_id, contact_id: categoryId ? contactId : contactId, category_id: categoryId, label: fact.label, value: fact.value, sort_order: 0, origin: "ai_moment" })
        .select("id")
        .single();
        if (error && (error as any).code === "23505") return { ...s, status: "removed" };
      if (error || !data) return { ...s, status: "pending_review" };
      return { ...s, status: "auto_applied_unreviewed", target_entity_id: (data as any).id, applied_at: new Date().toISOString() };
    }
    if (s.suggestion_type === "add_relationship") {
      const p = s.payload as Record<string, string | null>;
      if (!p.source_type || !p.target_type || !p.label) return { ...s, status: "pending_review" };
      const relationshipDecision = relationshipWriteDecision({
        userId: s.user_id,
        sourceType: p.source_type as "contact" | "self",
        sourceId: p.source_id || null,
        targetType: p.target_type as "contact" | "self",
        targetId: p.target_id || null,
        label: p.label,
      });
      if (relationshipDecision.ok === false) return { ...s, status: "removed" };
      const evidenceQuote = String(p.evidence_quote || "").trim();
      if (evidenceQuote.length < 10) return { ...s, status: "pending_review" };
      const { data, error } = await supabase
        .from("contact_relationships")
        .insert({
          user_id: s.user_id,
          source_type: p.source_type,
          source_id: p.source_id || null,
          target_type: p.target_type,
          target_id: p.target_id || null,
          label: relationshipDecision.label,
          custom_label: p.custom_label || null,
          origin: "ai_moment",
          evidence_quote: evidenceQuote,
          evidence_note_id: p.note_id || null,
        })
        .select("id")
        .single();
      if (error || !data) return { ...s, status: "pending_review" };
      return { ...s, status: "auto_applied_unreviewed", target_entity_id: (data as any).id, applied_at: new Date().toISOString() };
    }
  } catch (err) {
    console.error("[moment-extract] auto-apply failed:", err);
  }
  return { ...s, status: "pending_review" };
}

async function filterSuppressed(supabase: SupabaseClient, userId: string, suggestions: Suggestion[]) {
  if (suggestions.length === 0) return suggestions;
  const keys = suggestions.map((s) => s.suppression_key).filter(Boolean) as string[];
  if (keys.length === 0) return suggestions;
  const { data } = await supabase
    .from("ai_suggestion_suppressions")
    .select("suppression_key")
    .eq("user_id", userId)
    .in("suppression_key", keys);
  const blocked = new Set((data || []).map((r: any) => r.suppression_key));
  return suggestions.filter((s) => !s.suppression_key || !blocked.has(s.suppression_key));
}

export type MomentExtractionResult = {
  scanned: number;
  suggestions_created: number;
  auto_applied: number;
  skipped_reason?: string;
};

export async function extractProfileFromMoment(
  supabase: SupabaseClient,
  momentId: string,
): Promise<MomentExtractionResult> {
  const empty = { scanned: 0, suggestions_created: 0, auto_applied: 0 };

  // 1. Load moment + participants + provenance.
  const { data: moment, error: momentErr } = await supabase
    .from("moments")
    .select("id, user_id, title, description, happened_at, happened_end, category, status, source, ai_visibility, person_id")
    .eq("id", momentId)
    .is("deleted_at", null)
    .maybeSingle();
  if (momentErr || !moment) {
    return { ...empty, skipped_reason: "moment_not_found" };
  }
  if ((moment as any).ai_visibility === "hidden") {
    return { ...empty, skipped_reason: "ai_hidden" };
  }

  // Pre-filter: skip moments whose title is dominated by event-only verbs
  // (e.g. "Yumei adds Michael to her Discord banner"). Saves an LLM call and
  // prevents the model from hallucinating ongoing attributes from one-time
  // actions.
  if (isLikelyEventOnlyMoment((moment as any).title, (moment as any).description)) {
    console.log(`[moment-extract] pre-filter skipped: event-only verb (moment ${momentId}, title="${(moment as any).title}")`);
    return { ...empty, skipped_reason: "event_only_moment" };
  }

  const userId = (moment as any).user_id as string;

  const { data: participantRows } = await supabase
    .from("moment_participants")
    .select("person_id")
    .eq("moment_id", momentId);
  const participantIds: string[] = [];
  for (const row of (participantRows || []) as any[]) {
    if (row.person_id) participantIds.push(row.person_id);
  }
  if ((moment as any).person_id && !participantIds.includes((moment as any).person_id)) {
    participantIds.push((moment as any).person_id);
  }
  if (participantIds.length === 0) {
    return { ...empty, skipped_reason: "no_participants" };
  }

  const { data: contacts } = await supabase
    .from("contacts")
    .select("id, name")
    .eq("user_id", userId)
    .in("id", participantIds)
    .is("merged_into", null);
  const matchedPeople = (contacts || []).map((c: any) => ({
    contact_id: c.id as string,
    canonical_name: c.name as string,
  }));
  if (matchedPeople.length === 0) return { ...empty, skipped_reason: "no_matched_contacts" };

  // 2. Provenance — affects confidence cap.
  const { count: provenanceCount } = await supabase
    .from("moment_provenance")
    .select("id", { count: "exact", head: true })
    .eq("moment_id", momentId);
  const isDocumentBacked = (provenanceCount || 0) > 0;
  const isManualSource = ((moment as any).source || "manual") === "manual" && !isDocumentBacked;

  // 3. Prefs + balance.
  const prefs = await getPrefs(supabase, userId);
  if (prefs.mode === "off") return { ...empty, skipped_reason: "suggestions_off" };

  const balance = await checkBalance(supabase as any, userId);
  if (!balance.allowed) return { ...empty, skipped_reason: "insufficient_credits" };

  // Self context — used so the model can extract self↔participant relationships
  // (e.g. "Xihui and my wedding day" ⇒ self ↔ Xihui = spouse).
  const { data: selfProfile } = await supabase
    .from("profiles")
    .select("display_name")
    .eq("id", userId)
    .maybeSingle();
  const selfDisplayName = ((selfProfile as any)?.display_name as string | undefined) || "Me";
  const selfAliases = buildSelfAliases([selfDisplayName, "me", "i", "my", "myself"]);

  // 4. Build prompt text from the moment.
  const lines = [
    `Moment title: ${(moment as any).title}`,
    `Date: ${(moment as any).happened_at}${(moment as any).happened_end ? ` → ${(moment as any).happened_end}` : ""}`,
    `Status: ${(moment as any).status}`,
    `Note author (self / "me" / "I"): ${selfDisplayName}`,
  ];
  if ((moment as any).category) lines.push(`Category: ${(moment as any).category}`);
  if ((moment as any).description) lines.push(`Description: ${(moment as any).description}`);
  lines.push(`Participants: ${matchedPeople.map((p) => p.canonical_name).join(", ")}`);
  lines.push(
    `When extracting relationships, you may use "me" / "myself" for the note author (${selfDisplayName}). Marriage cues (wife, husband, married, wedding day, anniversary) imply spouse.`,
  );
  const userPrompt = lines.join("\n");

  // 5. LLM call.
  let parsed: any;
  try {
    const result = await runChat({
      db: supabase as any,
      userId,
      callSite: "extract-moment-profile",
      messages: [{ role: "user", content: userPrompt }],
      defaults: {
        provider: "openrouter",
        model: "deepseek/deepseek-v4-flash",
        systemPrompt: MOMENT_PROFILE_EXTRACTION_PROMPT,
      },
      callOptions: { response_format: { type: "json_object" } },
    });
    parsed = JSON.parse(result.content);
  } catch (err: any) {
    if (err?.message === "INSUFFICIENT_CREDITS") return { ...empty, skipped_reason: "insufficient_credits" };
    console.error("[moment-extract] LLM error:", err);
    return { ...empty, skipped_reason: "llm_error" };
  }

  const rawFacts: Array<any> = Array.isArray(parsed?.facts) ? parsed.facts : (Array.isArray(parsed) ? parsed : []);
  const rawRels: Array<any> = Array.isArray(parsed?.relationships) ? parsed.relationships : [];

  const nameToContact = new Map(matchedPeople.map((p) => [p.canonical_name.toLowerCase(), p]));

  // 6. Load existing entries / queue items for dedup.
  const contactIds = matchedPeople.map((p) => p.contact_id);
  const { data: existingEntries } = await supabase
    .from("profile_entries")
    .select("contact_id, label, value")
    .eq("user_id", userId)
    .in("contact_id", contactIds);
  const { data: existingQueue } = await supabase
    .from("review_queue")
    .select("payload, status")
    .eq("user_id", userId)
    .eq("suggestion_type", "add_profile_entry")
    .in("status", ["pending", "pending_review", "auto_applied_unreviewed", "kept", "blocked", "accepted", "dismissed"]);

  // Token-aware dedup: canonicalizes list-valued labels so reshuffled
  // multi-item values (e.g. "MDD, BPD" vs "MDD, BPD, ASD") stop looking
  // like distinct facts. See _shared/profile-dedup.ts for the details.
  const dedupIndex = buildProfileTokenIndex(
    (existingEntries || []) as any[],
    (existingQueue || []).map((q: any) => ({
      contact_id: q.payload?.contact_id ?? null,
      label: String(q.payload?.label || ""),
      value: String(q.payload?.value || ""),
    })),
  );


  // 7. Load profile_categories so we can map slug → id for auto-apply.
  const { data: categories } = await supabase
    .from("profile_categories")
    .select("id, slug, contact_id")
    .eq("user_id", userId)
    .in("contact_id", contactIds);

  const noteTitleLike = `Timeline: ${(moment as any).title}`;
  const baseConfidence = isManualSource
    ? Math.min(MANUAL_MOMENT_CONFIDENCE_CAP, DEFAULT_CONFIDENCE.add_profile_entry)
    : DEFAULT_CONFIDENCE.add_profile_entry;

  // 8. Build suggestions.
  const suggestions: Suggestion[] = [];

  for (const rawFact of rawFacts) {
    const contactName = String(rawFact?.contact_name || "").trim();
    const categorySlug = String(rawFact?.category_slug || "").trim().toLowerCase();
    const label = String(rawFact?.label || "").trim();
    const value = String(rawFact?.value || "").trim();
    if (!contactName || !categorySlug || !label || !value) continue;
    if (!PROFILE_CATEGORY_SLUGS.includes(categorySlug)) continue;
    const contact = nameToContact.get(contactName.toLowerCase());
    if (!contact) continue;

    const labelLower = label.toLowerCase();

    // Post-filter: label must be in the allowlist.
    if (!ALLOWED_LABEL_SET.has(labelLower)) {
      console.log(`[moment-extract] post-filter dropped: label not in allowlist (label="${label}", moment ${momentId})`);
      continue;
    }

    // Post-filter: value must appear in source text (with birthday exception).
    const sourceText = `${(moment as any).title} ${(moment as any).description || ""}`;
    if (!valueAppearsInSource(value, label, sourceText)) {
      console.log(`[moment-extract] post-filter dropped: value not in source (label="${label}", value="${value}", moment ${momentId})`);
      continue;
    }

    const dd = dedupIncomingProfileValue({
      contactId: contact.contact_id,
      label,
      value,
      index: dedupIndex,
    });
    if (dd.action === "skip") {
      console.log(`[moment-extract] dedup skip (${dd.reason}) "${label}: ${value}" for ${contact.canonical_name}`);
      continue;
    }
    const effectiveValue = dd.value;

    const catRow = (categories || []).find((c: any) => c.slug === categorySlug && c.contact_id === contact.contact_id);

    const payload: Record<string, unknown> = {
      contact_id: contact.contact_id,
      contact_name: contact.canonical_name,
      category_slug: categorySlug,
      category_id: catRow?.id || null,
      label,
      value: effectiveValue,
      source: `moment:${momentId}`,
      moment_id: momentId,
      moment_title: (moment as any).title,
    };

    suggestions.push({
      user_id: userId,
      source_note_id: null,
      suggestion_type: "add_profile_entry",
      title: `Add to ${contact.canonical_name}'s profile: ${label}`,
      description: `"${effectiveValue}" — extracted from timeline moment "${(moment as any).title}"`,
      payload,
      status: "pending_review",
      target_entity_type: "profile_entry",
      source_title: noteTitleLike,
      extracted_value: `${label}: ${effectiveValue}`,
      confidence_score: baseConfidence,
      is_sensitive: isSensitive("add_profile_entry", payload, `${(moment as any).title} ${(moment as any).description || ""}`),
      suppression_key: buildSuppressionKey("add_profile_entry", "contact", contact.contact_id, `${label}:${effectiveValue}`),
    });
  }


  // Relationships — now supports self ↔ contact (e.g. "my wife Xihui").
  const [{ data: existingRels }, { data: existingRelQueue }] = await Promise.all([
    supabase
      .from("contact_relationships")
      .select("source_type, source_id, target_type, target_id, label")
      .eq("user_id", userId),
    supabase
      .from("review_queue")
      .select("payload, status")
      .eq("user_id", userId)
      .eq("suggestion_type", "add_relationship")
      .in("status", ["pending", "pending_review", "auto_applied_unreviewed", "kept", "accepted"]),
  ]);

  const relSeenKeys = new Set<string>();
  for (const r of existingRels || []) {
    const a: EntityRef = { type: (r as any).source_type, id: (r as any).source_id };
    const b: EntityRef = { type: (r as any).target_type, id: (r as any).target_id };
    relSeenKeys.add(relationshipPairKey(userId, a, b, (r as any).label));
  }
  for (const q of existingRelQueue || []) {
    const p = (q as any).payload || {};
    if (!p.source_type || !p.target_type || !p.label) continue;
    const a: EntityRef = { type: p.source_type, id: p.source_id || null };
    const b: EntityRef = { type: p.target_type, id: p.target_id || null };
    relSeenKeys.add(relationshipPairKey(userId, a, b, p.label));
  }

  for (const rel of rawRels) {
    const rawA = String(rel?.person_a || "").trim();
    const rawB = String(rel?.person_b || "").trim();
    if (!rawA || !rawB) continue;

    const isSelfA = isSelfName(rawA, selfAliases);
    const isSelfB = isSelfName(rawB, selfAliases);
    if (isSelfA && isSelfB) continue;

    const a = isSelfA ? null : nameToContact.get(rawA.toLowerCase());
    const b = isSelfB ? null : nameToContact.get(rawB.toLowerCase());
    if (!isSelfA && !a) continue;
    if (!isSelfB && !b) continue;
    if (a && b && a.contact_id === b.contact_id) continue;

    const canonical = canonicalLabel(rel?.label_a_to_b);
    if (!canonical) continue;
    const inverse = canonicalLabel(rel?.label_b_to_a) || inverseLabel(canonical);

    const aRef: EntityRef = { type: isSelfA ? "self" : "contact", id: isSelfA ? null : a!.contact_id };
    const bRef: EntityRef = { type: isSelfB ? "self" : "contact", id: isSelfB ? null : b!.contact_id };
    const pairKey = relationshipPairKey(userId, aRef, bRef, canonical);
    if (relSeenKeys.has(pairKey)) continue;
    relSeenKeys.add(pairKey);

    const nameA = isSelfA ? selfDisplayName : a!.canonical_name;
    const nameB = isSelfB ? selfDisplayName : b!.canonical_name;
    const title = `Add relationship: ${nameA} → ${nameB} (${canonical})`;

    const payload: Record<string, unknown> = {
      source_type: aRef.type,
      source_id: aRef.id,
      target_type: bRef.type,
      target_id: bRef.id,
      label: canonical,
      inverse_label: isSymmetricLabel(canonical) ? null : inverse,
      contact_name_a: nameA,
      contact_name_b: nameB,
      source: `moment:${momentId}`,
      moment_id: momentId,
      moment_title: (moment as any).title,
    };

    suggestions.push({
      user_id: userId,
      source_note_id: null,
      suggestion_type: "add_relationship",
      title,
      description: `${nameA} is ${canonical} of ${nameB}`,
      payload,
      status: "pending_review",
      target_entity_type: "relationship",
      source_title: noteTitleLike,
      extracted_value: `${nameA} ${canonical} ${nameB}`,
      confidence_score: isManualSource
        ? Math.min(MANUAL_MOMENT_CONFIDENCE_CAP, DEFAULT_CONFIDENCE.add_relationship)
        : DEFAULT_CONFIDENCE.add_relationship,
      is_sensitive: isSensitive("add_relationship", payload, `${(moment as any).title} ${(moment as any).description || ""}`),
      suppression_key: buildSuppressionKey("add_relationship", "relationship", null, pairKey),
    });
  }

  if (suggestions.length === 0) {
    return { ...empty, scanned: 1 };
  }

  // 9. Filter suppressed + prepare + insert.
  const unsuppressed = await filterSuppressed(supabase, userId, suggestions);
  const prepared = await Promise.all(unsuppressed.map((s) => prepareForInsert(supabase, s, prefs)));
  if (prepared.length === 0) return { ...empty, scanned: 1 };

  const { error: insErr } = await supabase.from("review_queue").insert(prepared);
  if (insErr) {
    console.error("[moment-extract] insert error:", insErr);
    return { ...empty, scanned: 1, skipped_reason: "insert_error" };
  }

  const autoApplied = prepared.filter((s) => s.status === "auto_applied_unreviewed").length;
  return {
    scanned: 1,
    suggestions_created: prepared.length,
    auto_applied: autoApplied,
  };
}

export function createServiceClient() {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
}
