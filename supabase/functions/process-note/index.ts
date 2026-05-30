import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  checkBalance,
  getEmbeddingWithCredits,
  chatWithCredits,
  insufficientCreditsResponse,
} from "../_shared/llm-credits.ts";
import { embedAndStoreNoteChunks } from "../_shared/chunk-embeddings.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const OPENROUTER_API_KEY = Deno.env.get("OPENROUTER_API_KEY")!;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

/** Strip HTML tags and decode common entities to produce plain text.
 *  Also handles markdown content (passes through mostly as-is). */
function stripHtmlIfNeeded(content: string): string {
  // If content doesn't look like HTML, it's already markdown — return as-is
  if (!/<(?:p|h[1-6]|ul|ol|li|blockquote|pre|img|table)\b/i.test(content)) {
    return content;
  }
  // Legacy HTML content — strip tags
  return content
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]*>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/* ── Levenshtein distance (lightweight, no deps) ── */
function levenshtein(a: string, b: string): number {
  const la = a.length, lb = b.length;
  if (la === 0) return lb;
  if (lb === 0) return la;
  const dp: number[] = Array.from({ length: lb + 1 }, (_, i) => i);
  for (let i = 1; i <= la; i++) {
    let prev = i - 1;
    dp[0] = i;
    for (let j = 1; j <= lb; j++) {
      const tmp = dp[j];
      dp[j] = a[i - 1] === b[j - 1] ? prev : 1 + Math.min(prev, dp[j], dp[j - 1]);
      prev = tmp;
    }
  }
  return dp[lb];
}

/** Returns true if two names are "close enough" to be the same person */
function isFuzzyMatch(a: string, b: string): boolean {
  const la = a.toLowerCase(), lb = b.toLowerCase();
  if (la === lb) return true;
  const dist = levenshtein(la, lb);
  const maxLen = Math.max(la.length, lb.length);
  // For short names (≤5 chars) allow distance 1; otherwise allow 2 or normalized < 0.3
  if (maxLen <= 5) return dist <= 1;
  return dist <= 2 || dist / maxLen < 0.3;
}

/** Check if a name appears (approximately) in the source text */
function nameAppearsInText(name: string, text: string): boolean {
  const lower = text.toLowerCase();
  const nameLower = name.toLowerCase();
  // Direct substring check
  if (lower.includes(nameLower)) return true;
  // Check individual words of the name against text words
  const nameWords = nameLower.split(/\s+/);
  return nameWords.some((w) => w.length >= 3 && lower.includes(w));
}

function normalizeSuggestionValue(value: unknown): string {
  return String(value || "").trim().toLowerCase().replace(/\s+/g, " ");
}

/* ── Self-recognition helpers ── */
type SelfContext = {
  enabled: boolean;
  aliases: Set<string>; // lowercased
  preferredName: string | null;
};

async function loadSelfContext(userId: string): Promise<SelfContext> {
  const aliases = new Set<string>();
  let enabled = true;
  let preferredName: string | null = null;

  const { data: profile } = await supabase
    .from("profiles")
    .select("display_name, self_matching_enabled")
    .eq("id", userId)
    .maybeSingle();

  if (profile) {
    enabled = (profile as any).self_matching_enabled !== false;
    const dn = ((profile as any).display_name || "").trim();
    if (dn) {
      preferredName = dn;
      const first = dn.split(/\s+/)[0];
      if (first) aliases.add(first.toLowerCase());
      aliases.add(dn.toLowerCase());
    }
  }

  if (!enabled) return { enabled: false, aliases: new Set(), preferredName };

  const { data: rows } = await supabase
    .from("user_self_aliases")
    .select("alias, is_active")
    .eq("user_id", userId)
    .eq("is_active", true);

  for (const r of (rows || []) as any[]) {
    const a = String(r.alias || "").trim().toLowerCase();
    if (a) aliases.add(a);
  }

  return { enabled: true, aliases, preferredName };
}

/** Strip possessive 's / German genitive trailing s for matching. */
function stripPossessive(name: string): string {
  return name.replace(/['']s$/i, "").replace(/s$/i, (s, _i, full) => full.length > 3 ? "" : s).trim();
}

function nameMatchesAlias(name: string, aliases: Set<string>): boolean {
  const lower = name.trim().toLowerCase();
  if (aliases.has(lower)) return true;
  const stripped = stripPossessive(lower);
  return stripped !== lower && aliases.has(stripped);
}

/** Extract a small context window around the first occurrence of `name` in text. */
function contextWindow(name: string, text: string, radius = 200): string {
  const lower = text.toLowerCase();
  const idx = lower.indexOf(name.toLowerCase());
  if (idx < 0) return "";
  const start = Math.max(0, idx - radius);
  const end = Math.min(text.length, idx + name.length + radius);
  return text.slice(start, end);
}

const SELF_MARKERS_DE = ["mein", "meine", "meinen", "meiner", "meines", "ich ", "mir ", "mich "];
const SELF_MARKERS_EN = ["my ", "i ", "me ", "myself", "i'm", "i've", "i'll"];
// Relationship/3rd-party markers — these strongly indicate the mention is about another person,
// even if a 1st-person pronoun ("my") appears right before it.
const OTHER_MARKERS = [
  // English – relationships
  "my wife", "my husband", "my partner", "my spouse", "my fiancé", "my fiancée", "my fiance", "my fiancee",
  "my girlfriend", "my boyfriend", "my ex",
  "my mother", "my mom", "my mum", "my father", "my dad",
  "my son", "my daughter", "my child", "my kid",
  "my brother", "my sister", "my sibling",
  "my uncle", "my aunt", "my cousin", "my nephew", "my niece",
  "my grandfather", "my grandmother", "my grandpa", "my grandma",
  "my friend", "my best friend", "my colleague", "my coworker", "my co-worker", "my acquaintance",
  "my boss", "my manager", "my client", "my mentor", "my mentee", "my neighbor", "my neighbour",
  "met ", "we met", "talked to", "spoke with", "called ",
  // German – relationships
  "meine frau", "mein mann", "mein partner", "meine partnerin", "mein verlobter", "meine verlobte",
  "meine freundin", "mein freund", "mein ex", "meine ex",
  "meine mutter", "meine mama", "mein vater", "mein papa",
  "mein sohn", "meine tochter", "mein kind",
  "mein bruder", "meine schwester", "mein geschwister",
  "mein onkel", "meine tante", "mein cousin", "meine cousine", "mein neffe", "meine nichte",
  "mein opa", "meine oma", "mein großvater", "meine großmutter",
  "mein bekannter", "meine bekannte", "mein kollege", "meine kollegin", "mein chef", "meine chefin",
  "mein nachbar", "meine nachbarin", "mein klient", "meine klientin", "mein mentor", "meine mentorin",
  "traf ", "wir trafen", "sprach mit", "telefonierte mit",
];

type SelfDecision = {
  kind: "self" | "contact" | "ambiguous" | "skip";
  contactCandidates: Array<{ id: string; name: string }>;
  reason: string;
};

function disambiguateMention(
  person: string,
  noteText: string,
  self: SelfContext,
  contactCandidates: Array<{ id: string; name: string }>,
  preferredName?: string | null,
): SelfDecision {
  const personLower = person.toLowerCase();

  // Strongest signal: an exact contact name match (not just fuzzy / first-name) → contact wins.
  const exactContact = contactCandidates.find((c) => c.name.toLowerCase() === personLower);
  if (exactContact) {
    return { kind: "contact", contactCandidates: [exactContact], reason: "exact_contact_name" };
  }

  const isSelfAlias = self.enabled && nameMatchesAlias(person, self.aliases);

  if (!isSelfAlias) {
    if (contactCandidates.length > 0) {
      return { kind: "contact", contactCandidates, reason: "not_self_alias" };
    }
    // Not a self alias and no contact candidate → leave it for the
    // "Add to People" flow; do NOT create a "is this you?" review item.
    return { kind: "skip", contactCandidates: [], reason: "no_self_no_contact" };
  }

  // From here on, the mention matches a self alias.
  if (contactCandidates.length === 0) {
    // Only auto-accept "self" when the mention is clearly the user's own preferred name;
    // weaker aliases without context fall through to "ambiguous" so the user confirms once.
    if (preferredName && personLower === preferredName.toLowerCase()) {
      return { kind: "self", contactCandidates: [], reason: "self_preferred_name" };
    }
    return { kind: "self", contactCandidates: [], reason: "self_only" };
  }

  const ctx = contextWindow(person, noteText).toLowerCase();

  // Full-name presence of any contact candidate near mention → contact wins.
  for (const c of contactCandidates) {
    const parts = c.name.toLowerCase().split(/\s+/);
    if (parts.length >= 2 && ctx.includes(c.name.toLowerCase())) {
      return { kind: "contact", contactCandidates: [c], reason: "full_name_in_context" };
    }
  }

  // Other-person markers (relationships, "met …") nearby → contact.
  // Evaluated BEFORE self-markers so "my wife Xihui" resolves to the contact.
  if (OTHER_MARKERS.some((m) => ctx.includes(m))) {
    return { kind: "contact", contactCandidates, reason: "other_marker" };
  }

  // First-person markers nearby → self
  if (SELF_MARKERS_DE.some((m) => ctx.includes(m)) || SELF_MARKERS_EN.some((m) => ctx.includes(m))) {
    return { kind: "self", contactCandidates: [], reason: "self_marker" };
  }

  return { kind: "ambiguous", contactCandidates, reason: "name_collision" };
}

async function recallDisambiguation(userId: string, alias: string): Promise<{ target: string; contact_id: string | null } | null> {
  const { data } = await supabase
    .from("name_disambiguation_decisions")
    .select("target, target_contact_id, decision_count, confidence")
    .eq("user_id", userId)
    .eq("alias_lower", alias.toLowerCase())
    .order("decision_count", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!data) return null;
  if ((data as any).decision_count >= 2 || (data as any).confidence >= 0.8) {
    return { target: (data as any).target, contact_id: (data as any).target_contact_id };
  }
  return null;
}

async function recordDisambiguation(
  userId: string,
  alias: string,
  target: "self" | "contact",
  contactId: string | null,
  confidence: number,
) {
  const lower = alias.toLowerCase();
  // Look up existing
  const { data: existing } = await supabase
    .from("name_disambiguation_decisions")
    .select("id, decision_count, confidence")
    .eq("user_id", userId)
    .eq("alias_lower", lower)
    .eq("context_kind", "global")
    .eq("target", target)
    .eq("target_contact_id", contactId)
    .maybeSingle();
  if (existing) {
    await supabase
      .from("name_disambiguation_decisions")
      .update({
        decision_count: ((existing as any).decision_count || 0) + 1,
        confidence: Math.min(1, Math.max((existing as any).confidence || 0, confidence)),
        last_seen_at: new Date().toISOString(),
      })
      .eq("id", (existing as any).id);
  } else {
    await supabase.from("name_disambiguation_decisions").insert({
      user_id: userId,
      alias_lower: lower,
      context_kind: "global",
      target,
      target_contact_id: contactId,
      confidence,
    });
  }
}

function buildSuppressionKey(suggestionType: string, targetEntityType: string | null, targetEntityId: string | null, value: unknown) {
  return [suggestionType, targetEntityType || "none", targetEntityId || "none", normalizeSuggestionValue(value)].join(":");
}

function isSensitiveSuggestion(suggestionType: string, payload: Record<string, unknown>, text = "") {
  const haystack = `${suggestionType} ${text} ${Object.values(payload).join(" ")}`.toLowerCase();
  return SENSITIVE_TERMS.some((term) => haystack.includes(term));
}

async function getSuggestionPreferences(userId: string) {
  const { data } = await supabase
    .from("ai_suggestion_preferences")
    .select("suggestion_mode, suggestion_sensitivity, auto_add_sensitive, person_blocklist")
    .eq("user_id", userId)
    .maybeSingle();

  return {
    mode: (data as any)?.suggestion_mode || "auto",
    sensitivity: (data as any)?.suggestion_sensitivity || "balanced",
    autoAddSensitive: (data as any)?.auto_add_sensitive === true,
    personBlocklist: Array.isArray((data as any)?.person_blocklist)
      ? ((data as any).person_blocklist as string[]).map((n) => String(n).trim().toLowerCase()).filter(Boolean)
      : [],
  };
}

/* ── Source-aware confidence dampening ──
 * Notes captured from external/foreign content (web clips, forwards) are far less likely
 * to mention people who actually belong in the user's contact book. */
function getSourceConfidenceFactor(metadata: Record<string, unknown>): { factor: number; sourceTag: string } {
  const source = String((metadata as any)?.source || (metadata as any)?.source_app || "").toLowerCase();
  // Web clips: heavily dampened — almost everything is third-party content.
  if (source === "singlefile" || source === "web_clip" || source === "webclip" || source === "browser_clip") {
    return { factor: 0.5, sourceTag: "web_clip" };
  }
  // Forwarded/relayed content: moderately dampened.
  if (source === "telegram" || source === "discord" || source === "github" || source === "github_sync" || source === "email") {
    return { factor: 0.7, sourceTag: "forwarded" };
  }
  // First-party capture surfaces: full trust.
  return { factor: 1.0, sourceTag: "first_party" };
}

/* ── Generic / demo names that virtually never belong in a real contact list ── */
const GENERIC_PERSON_NAMES = new Set([
  "john doe", "jane doe", "john smith", "jane smith",
  "max mustermann", "erika mustermann", "lieschen müller", "lieschen mueller",
  "lorem ipsum", "foo bar", "alice", "bob", "alice and bob",
  "test user", "demo user", "example user",
]);

/* ── Mention-strength scoring (no LLM, pure heuristic) ──
 * Returns a multiplier 0..1 for confidence, and a `drop` flag when the mention is too weak. */
function scorePersonMention(
  name: string,
  fullText: string,
  sourceTag: string,
): { score: number; drop: boolean; reason?: string } {
  const text = fullText;
  const lower = text.toLowerCase();
  const nameLower = name.toLowerCase();

  // Hard block: generic placeholder names.
  if (GENERIC_PERSON_NAMES.has(nameLower)) {
    return { score: 0, drop: true, reason: "generic_name" };
  }

  // Count occurrences (word-boundary, case-insensitive).
  const escaped = nameLower.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const matches = lower.match(new RegExp(`\\b${escaped}\\b`, "g"));
  const occurrences = matches ? matches.length : 0;

  if (occurrences === 0) {
    // Substring fallback (e.g. multi-word vs first-name only). Don't drop here — caller handles.
    return { score: 0.5, drop: false, reason: "no_word_boundary_match" };
  }

  // Look at the 60-char windows around each mention for context signals.
  const windows: string[] = [];
  let searchFrom = 0;
  while (searchFrom < lower.length) {
    const idx = lower.indexOf(nameLower, searchFrom);
    if (idx === -1) break;
    const start = Math.max(0, idx - 60);
    const end = Math.min(lower.length, idx + nameLower.length + 60);
    windows.push(lower.slice(start, end));
    searchFrom = idx + nameLower.length;
  }
  const ctx = windows.join(" | ");

  // Strong relational markers — first-person involvement.
  const firstPersonMarkers = [
    "my friend", "my colleague", "my coworker", "my partner", "my boss", "my client", "my mentor",
    "my brother", "my sister", "my mother", "my father", "my mom", "my dad", "my wife", "my husband", "my son", "my daughter",
    "i met", "we met", "i spoke with", "i talked to", "i called", "called me", "wrote me", "asked me", "told me",
    "i had lunch", "i had dinner", "i had coffee", "had a meeting with", "meeting with",
    // German equivalents
    "mein freund", "meine freundin", "mein kollege", "meine kollegin", "mein chef", "meine chefin",
    "habe mit", "gesprochen mit", "getroffen", "treffen mit", "telefoniert mit",
  ];
  const hasFirstPerson = firstPersonMarkers.some((m) => ctx.includes(m));

  // Web-content "third party" markers — strong negative signal.
  const thirdPartyMarkers = [
    "ceo", "cto", "founder", "co-founder", "cofounder", "president", "director",
    "testimonial", "review by", "writes:", "says:", "according to", "interviewed",
    "author", "reporter", "journalist",
    // German
    "geschäftsführer", "gründer", "vorstand", "autor", "autorin", "redakteur",
  ];
  const hasThirdParty = thirdPartyMarkers.some((m) => ctx.includes(m));

  // Density: very long doc + only a single mention => almost certainly incidental.
  const isLongDoc = text.length > 5000;

  // Decision logic.
  if (sourceTag === "web_clip") {
    // Web clip is hostile territory — require strong evidence to even SUGGEST.
    if (hasFirstPerson && !hasThirdParty) {
      return { score: 0.8, drop: false };
    }
    if (occurrences >= 3 && !hasThirdParty) {
      return { score: 0.5, drop: false, reason: "repeated_mention" };
    }
    return { score: 0, drop: true, reason: hasThirdParty ? "third_party_context" : (isLongDoc ? "incidental_in_long_doc" : "weak_mention") };
  }

  if (sourceTag === "forwarded") {
    if (hasFirstPerson) return { score: 0.9, drop: false };
    if (hasThirdParty && occurrences === 1) return { score: 0, drop: true, reason: "third_party_context" };
    if (isLongDoc && occurrences === 1) return { score: 0.4, drop: false, reason: "single_mention_long_doc" };
    return { score: occurrences >= 2 ? 0.85 : 0.65, drop: false };
  }

  // First-party (manual / quick-capture / slack): trust by default.
  if (hasThirdParty && occurrences === 1 && isLongDoc) {
    return { score: 0.5, drop: false, reason: "third_party_context" };
  }
  return { score: 1.0, drop: false };
}

async function filterSuppressedSuggestions(userId: string, suggestions: ReviewSuggestion[]) {
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

async function prepareSuggestionForInsert(suggestion: ReviewSuggestion, preferences: { mode: string; sensitivity: string; autoAddSensitive: boolean }) {
  const threshold = SENSITIVITY_THRESHOLDS[preferences.sensitivity] || SENSITIVITY_THRESHOLDS.balanced;
  const confidence = suggestion.confidence_score ?? 0;
  // Never auto-apply add_contact — creating a new person is an identity decision the user should confirm.
  if (suggestion.suggestion_type === "add_contact") {
    return { ...suggestion, status: "pending_review" };
  }
  const canAutoApply = preferences.mode === "auto" && confidence >= threshold && (!suggestion.is_sensitive || preferences.autoAddSensitive);

  if (!canAutoApply) {
    return { ...suggestion, status: "pending_review" };
  }

  try {
    if (suggestion.suggestion_type === "add_contact") {
      const name = String(suggestion.payload.name || "").trim();
      if (!name) return { ...suggestion, status: "pending_review" };
      const { data, error } = await supabase
        .from("contacts")
        .insert({ user_id: suggestion.user_id, name })
        .select("id")
        .single();
      if (error || !data) return { ...suggestion, status: "pending_review" };
      return { ...suggestion, status: "auto_applied_unreviewed", target_entity_id: data.id, applied_at: new Date().toISOString() };
    }

    if (suggestion.suggestion_type === "add_alias") {
      const contactId = suggestion.payload.contact_id as string | undefined;
      const alias = String(suggestion.payload.alias || "").trim();
      if (!contactId || !alias) return { ...suggestion, status: "pending_review" };
      const { data: contact } = await supabase.from("contacts").select("aliases").eq("id", contactId).maybeSingle();
      const aliases = Array.isArray((contact as any)?.aliases) ? (contact as any).aliases : [];
      if (!aliases.some((a: string) => a.toLowerCase() === alias.toLowerCase())) {
        await supabase.from("contacts").update({ aliases: [...aliases, alias] }).eq("id", contactId);
      }
      return { ...suggestion, status: "auto_applied_unreviewed", target_entity_id: contactId, applied_at: new Date().toISOString() };
    }

    if (suggestion.suggestion_type === "add_profile_entry") {
      const contactId = suggestion.payload.contact_id as string | undefined;
      const categoryId = suggestion.payload.category_id as string | null | undefined;
      const label = String(suggestion.payload.label || "").trim();
      const value = String(suggestion.payload.value || "").trim();
      if (!contactId || !categoryId || !label || !value) return { ...suggestion, status: "pending_review" };
      const { data, error } = await supabase
        .from("profile_entries")
        .insert({ user_id: suggestion.user_id, contact_id: contactId, category_id: categoryId, label, value, sort_order: 0 })
        .select("id")
        .single();
      if (error || !data) return { ...suggestion, status: "pending_review" };
      return { ...suggestion, status: "auto_applied_unreviewed", target_entity_id: data.id, applied_at: new Date().toISOString() };
    }

    if (suggestion.suggestion_type === "add_relationship") {
      const { source_type, source_id, target_type, target_id, label, custom_label } = suggestion.payload as Record<string, string | null>;
      if (!source_type || !target_type || !label) return { ...suggestion, status: "pending_review" };
      const { data, error } = await supabase
        .from("contact_relationships")
        .insert({ user_id: suggestion.user_id, source_type, source_id: source_id || null, target_type, target_id: target_id || null, label, custom_label: custom_label || null })
        .select("id")
        .single();
      if (error || !data) return { ...suggestion, status: "pending_review" };
      return { ...suggestion, status: "auto_applied_unreviewed", target_entity_id: data.id, applied_at: new Date().toISOString() };
    }
  } catch (err) {
    console.error("auto-apply suggestion failed:", err);
  }

  return { ...suggestion, status: "pending_review" };
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const METADATA_SYSTEM_PROMPT = `Extract metadata from the user's note. Return JSON with:
- "title": If the first line of the note is 10 words or fewer and reads like a natural title or heading, use it verbatim. Otherwise, generate a concise title (max 8 words) that captures the essence of the note.
- "people": array of people mentioned (empty if none)

- "dates_mentioned": array of dates in YYYY-MM-DD format (empty if none)
- "topics": array of 1-5 short topic tags (always generate at least one)
- "type": one of "observation", "task", "idea", "reference", "person_note", "meeting_note", "decision", "project"
- "sentiment": one of "positive", "negative", "neutral"
- "summary": one-sentence summary of the note
Only extract what's explicitly there. Don't invent details.`;

const PROFILE_CATEGORY_SLUGS = [
  "identity", "location", "professional", "education", "relationships",
  "communication", "personality", "principles", "health", "hobbies",
  "food", "entertainment", "travel", "digital", "financial", "goals", "preferences",
];

type ReviewSuggestion = {
  user_id: string;
  source_note_id: string;
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

const SENSITIVITY_THRESHOLDS: Record<string, number> = {
  conservative: 0.85,
  balanced: 0.7,
  exploratory: 0.55,
};

const DEFAULT_CONFIDENCE: Record<string, number> = {
  add_contact: 0.8,
  add_alias: 0.78,
  add_profile_entry: 0.74,
  add_relationship: 0.72,
};

const SENSITIVE_TERMS = [
  "medical", "health", "diagnosis", "condition", "therapy", "depression", "anxiety", "mental",
  "pregnant", "pregnancy", "romantic", "sexual", "affair", "secret", "conflict", "legal", "lawsuit",
  "debt", "bankrupt", "financial hardship", "broke", "divorce", "addiction", "trauma",
];

const PROFILE_EXTRACTION_PROMPT = `You are extracting biographical facts about specific real people from a personal note.

Return a JSON object with two keys:
1. "facts": an array of profile fact objects, each with:
   - "contact_name": the person's name exactly as provided
   - "category_slug": one of: ${PROFILE_CATEGORY_SLUGS.join(", ")}
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

// Labels that should only ever have ONE pending suggestion / entry per contact at a time.
const SINGLETON_PROFILE_LABELS = new Set([
  "job title", "current job title", "role", "title",
  "company", "current company", "employer",
  "current city", "city", "location",
  "birthday", "date of birth", "dob", "geburtstag", "geburtsdatum",
  "pronouns", "nationality",
  "partner", "spouse",
]);

// Labels that all refer to the same canonical field. The first entry in each
// group is the canonical label that gets persisted.
const CANONICAL_LABEL_GROUPS: Array<{ canonical: string; aliases: string[] }> = [
  { canonical: "Date of birth", aliases: ["date of birth", "birthday", "birth date", "dob", "geburtstag", "geburtsdatum"] },
  { canonical: "Anniversary", aliases: ["anniversary", "wedding anniversary", "hochzeitstag"] },
];

function canonicalizeLabel(label: string): string {
  const lower = (label || "").trim().toLowerCase();
  for (const group of CANONICAL_LABEL_GROUPS) {
    if (group.aliases.includes(lower)) return group.canonical;
  }
  return label;
}

/**
 * Deterministic post-pass for the LLM profile extraction.
 *
 * Specifically: when the model returns label=Birthday with value like
 * "61st birthday on 2026-05-25" or "turned 61 on 2026-05-25", rewrite the
 * fact to {label: "Date of birth", value: "<year>-MM-DD"} where year is the
 * reference year minus the age. Falls back to noteDateISO if no explicit
 * reference date is in the value.
 */
function deriveCanonicalFacts(
  facts: Array<{ contact_name: string; category_slug: string; label: string; value: string }>,
  noteDateISO: string | null,
) {
  const out: typeof facts = [];
  for (const f of facts) {
    const label = (f.label || "").trim();
    const value = (f.value || "").trim();
    const labelLower = label.toLowerCase();
    const isBirthdayLabel = ["birthday", "date of birth", "dob", "geburtstag", "geburtsdatum"].includes(labelLower);

    if (isBirthdayLabel) {
      // If value already is an ISO date, just canonicalize the label.
      const isoMatch = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
      if (isoMatch) {
        out.push({ ...f, label: "Date of birth", value });
        continue;
      }

      // Patterns:
      //   "61st birthday on 2026-05-25"
      //   "turned 61 on 2026-05-25"
      //   "wurde 61 am 2026-05-25"
      //   "61. Geburtstag am 25.05.2026"
      const ageDateMatch =
        value.match(/(\d{1,3})\s*(?:st|nd|rd|th|\.)?\s*(?:birthday|geburtstag|years?\s*old)?[^0-9]{0,20}(\d{4})-(\d{2})-(\d{2})/i) ||
        value.match(/turned\s+(\d{1,3})\s+(?:on|am)\s+(\d{4})-(\d{2})-(\d{2})/i) ||
        value.match(/wurde\s+(\d{1,3})\s+(?:on|am)\s+(\d{4})-(\d{2})-(\d{2})/i);

      if (ageDateMatch) {
        const age = Number(ageDateMatch[1]);
        const refYear = Number(ageDateMatch[2]);
        const month = ageDateMatch[3];
        const day = ageDateMatch[4];
        if (age > 0 && age < 130 && refYear > 1900 && refYear < 2200) {
          const birthYear = refYear - age;
          out.push({ ...f, label: "Date of birth", value: `${birthYear}-${month}-${day}` });
          continue;
        }
      }

      // Age + note date fallback: "X turned 61 last week", with no explicit date in value
      const ageOnlyMatch = value.match(/(?:turned|wurde|is|ist)\s+(\d{1,3})/i) || value.match(/^(\d{1,3})\s*(?:st|nd|rd|th|\.)?\s*birthday/i);
      if (ageOnlyMatch && noteDateISO) {
        const age = Number(ageOnlyMatch[1]);
        const ref = new Date(noteDateISO);
        if (age > 0 && age < 130 && !Number.isNaN(ref.getTime())) {
          const birthYear = ref.getUTCFullYear() - age;
          const month = String(ref.getUTCMonth() + 1).padStart(2, "0");
          const day = String(ref.getUTCDate()).padStart(2, "0");
          out.push({ ...f, label: "Date of birth", value: `${birthYear}-${month}-${day}` });
          continue;
        }
      }

      // Otherwise: drop the fact rather than store unstructured text in a singleton field.
      console.log(`[profile-extract] dropping malformed birthday fact: "${value}"`);
      continue;
    }

    // Generic label canonicalization for non-birthday facts.
    out.push({ ...f, label: canonicalizeLabel(label) });
  }
  return out;
}

// Sources that are structurally NOT first-person observation. Profile extraction
// should be skipped for these to avoid mining biographical "facts" out of
// third-party content (prompt libraries, web clips, public repos, etc.).
const NON_BIOGRAPHICAL_SOURCES = new Set([
  "querino", "github", "singlefile", "web-clip", "webclip",
  "slack-public-channel",
]);

const MAX_FACTS_PER_CONTACT_PER_NOTE = 3;

/* ── Review Queue suggestion generator ── */
async function generateReviewItems(
  userId: string,
  noteId: string,
  noteTitle: string,
  noteContent: string,
  metadata: Record<string, unknown>,
) {
  try {
    const people = Array.isArray(metadata.people) ? (metadata.people as string[]) : [];
    const dates = Array.isArray(metadata.dates_mentioned) ? (metadata.dates_mentioned as string[]) : [];
    const noteType = metadata.type as string | undefined;
    const summary = (metadata.summary as string) || noteTitle;

    const preferences = await getSuggestionPreferences(userId);
    if (preferences.mode === "off") return;

    const suggestions: ReviewSuggestion[] = [];

    // Person detection: check if mentioned people exist as contacts (alias-aware)
    if (people.length > 0) {
      const { data: existingContacts } = await supabase
        .from("contacts")
        .select("id, name, aliases")
        .eq("user_id", userId)
        .is("merged_into", null);

      const nameToContact = new Map<string, { id: string; name: string }>();
      for (const c of (existingContacts || []) as any[]) {
        nameToContact.set(c.name.toLowerCase(), { id: c.id, name: c.name });
        if (Array.isArray(c.aliases)) {
          for (const alias of c.aliases) {
            if (alias) nameToContact.set(alias.toLowerCase(), { id: c.id, name: c.name });
          }
        }
      }

      const fullText = `${noteTitle}\n${noteContent}`;
      const { factor: sourceFactor, sourceTag } = getSourceConfidenceFactor(metadata);
      const blocklist = new Set(preferences.personBlocklist || []);

      for (const person of people) {
        // 1. Exact match
        if (nameToContact.has(person.toLowerCase())) continue;

        // 2. User-defined / generic blocklist — drop completely.
        if (blocklist.has(person.toLowerCase())) {
          console.log(`Skipping blocklisted name "${person}"`);
          continue;
        }

        // 3. Fuzzy match — find close match among all contact names/aliases
        let fuzzyMatch: { id: string; name: string } | null = null;
        for (const [key, contact] of nameToContact) {
          if (isFuzzyMatch(person, key)) {
            fuzzyMatch = contact;
            break;
          }
        }

        if (fuzzyMatch) {
          // Aliases are still gated by source/mention strength: don't add an alias
          // to an existing contact based on a random name on a clipped homepage.
          const aliasMention = scorePersonMention(person, fullText, sourceTag);
          if (aliasMention.drop) {
            console.log(`Skipping weak alias suggestion "${person}" → ${fuzzyMatch.name} (${aliasMention.reason})`);
            continue;
          }
          const aliasConfidence = Math.max(0.1, Math.min(1, DEFAULT_CONFIDENCE.add_alias * sourceFactor * aliasMention.score));
          suggestions.push({
            user_id: userId,
            source_note_id: noteId,
            suggestion_type: "add_alias",
            title: `Add "${person}" as alias for ${fuzzyMatch.name}`,
            description: `"${person}" in "${noteTitle}" looks like ${fuzzyMatch.name}. Add as alternate spelling?`,
            payload: { contact_id: fuzzyMatch.id, contact_name: fuzzyMatch.name, alias: person },
            status: "pending_review",
            target_entity_type: "contact",
            target_entity_id: fuzzyMatch.id,
            source_title: noteTitle,
            extracted_value: person,
            confidence_score: aliasConfidence,
            is_sensitive: isSensitiveSuggestion("add_alias", { person, contact_name: fuzzyMatch.name }, noteContent),
            suppression_key: buildSuppressionKey("add_alias", "contact", fuzzyMatch.id, person),
          });
          continue;
        }

        // 4. No match — validate name appears in source text before suggesting
        if (!nameAppearsInText(person, fullText)) {
          console.log(`Skipping hallucinated name "${person}" — not found in note text`);
          continue;
        }

        // 5. Mention-strength scoring (drops weak / third-party mentions on web clips & forwards).
        const mention = scorePersonMention(person, fullText, sourceTag);
        if (mention.drop) {
          console.log(`Skipping weak person suggestion "${person}" from source=${sourceTag} (${mention.reason})`);
          continue;
        }

        const adjustedConfidence = Math.max(0.1, Math.min(1, DEFAULT_CONFIDENCE.add_contact * sourceFactor * mention.score));

        suggestions.push({
          user_id: userId,
          source_note_id: noteId,
          suggestion_type: "add_contact",
          title: `Add "${person}" to your People`,
          description: `${person} was mentioned in "${noteTitle}" but isn't in your contacts yet.`,
          payload: { name: person },
          status: "pending_review",
          target_entity_type: "contact",
          source_title: noteTitle,
          extracted_value: person,
          confidence_score: adjustedConfidence,
          is_sensitive: isSensitiveSuggestion("add_contact", { name: person }, noteContent),
          suppression_key: buildSuppressionKey("add_contact", "contact", null, person),
        });
      }
    }

    // Deduplicate against existing pending/accepted/dismissed suggestions
    if (suggestions.length > 0) {
      const { data: existing } = await supabase
        .from("review_queue")
        .select("id, suggestion_type, source_note_id, title, status")
        .eq("user_id", userId)
        .in("status", ["pending", "pending_review", "auto_applied_unreviewed", "kept", "removed", "blocked", "accepted", "dismissed", "skipped"]);

      const existingSet = new Set(
        (existing || [])
          .filter((e: any) => e.status !== "skipped")
          .map((e: any) => `${e.suggestion_type}|${e.title}`),
      );

      // Re-pending: reset skipped items that match new suggestions back to pending
      const skippedItems = (existing || []).filter((e: any) => e.status === "skipped");
      for (const suggestion of suggestions) {
        const key = `${suggestion.suggestion_type}|${suggestion.title}`;
        const skippedMatch = skippedItems.find(
          (e: any) => `${e.suggestion_type}|${e.title}` === key,
        );
        if (skippedMatch) {
          await supabase
            .from("review_queue")
            .update({ status: "pending_review", reviewed_at: null })
            .eq("id", skippedMatch.id);
          console.log(`Re-pending skipped suggestion: ${skippedMatch.title}`);
        }
      }

      const newSuggestions = suggestions.filter(
        (s) => {
          const key = `${s.suggestion_type}|${s.title}`;
          const alreadyExists = existingSet.has(key);
          const wasSkipped = skippedItems.some(
            (e: any) => `${e.suggestion_type}|${e.title}` === key,
          );
          return !alreadyExists && !wasSkipped;
        },
      );

      if (newSuggestions.length > 0) {
        const unsuppressed = await filterSuppressedSuggestions(userId, newSuggestions);
        const preparedSuggestions = await Promise.all(
          unsuppressed.map((suggestion) => prepareSuggestionForInsert(suggestion, preferences)),
        );
        const { error } = await supabase.from("review_queue").insert(preparedSuggestions);
        if (error) console.error("review_queue insert error:", error);
        else console.log(`Created ${preparedSuggestions.length} review suggestions for note ${noteId} (${suggestions.length - newSuggestions.length} duplicates skipped)`);
      } else {
        console.log(`All ${suggestions.length} suggestions already exist for note ${noteId}, skipping`);
      }
    }
  } catch (err) {
    console.error("generateReviewItems error:", err);
  }
}

/* ── Profile fact extraction for matched people ── */
async function generateProfileSuggestions(
  userId: string,
  noteId: string,
  noteTitle: string,
  noteContent: string,
  matchedPeople: Array<{ name: string; contact_id?: string; canonical_name?: string; is_self?: boolean }>,
  context?: { source_app?: string | null; is_external?: boolean | null; metadata?: Record<string, unknown>; note_created_at?: string | null },
) {
  const noteDateISO = context?.note_created_at ? new Date(context.note_created_at).toISOString().slice(0, 10) : null;
  matchedPeople = matchedPeople.filter((p) => p.contact_id && !p.is_self && p.canonical_name);
  if (matchedPeople.length === 0) return;

  // Skip extraction for non-biographical sources (prompt libraries, web clips, etc.)
  const sourceApp = (context?.source_app || "").toLowerCase();
  const metaType = String((context?.metadata as any)?.type || "").toLowerCase();
  const nonBiographicalType = ["prompt", "template", "article", "documentation", "doc", "code", "snippet"].includes(metaType);
  if (NON_BIOGRAPHICAL_SOURCES.has(sourceApp) || nonBiographicalType) {
    console.log(`[profile-extract] skipping note ${noteId}: source=${sourceApp || "none"} type=${metaType || "none"} not first-person`);
    return;
  }

  try {
      const preferences = await getSuggestionPreferences(userId);
      if (preferences.mode === "off") return;

    // Check balance before making another LLM call
    const balance = await checkBalance(supabase, userId);
    if (!balance.allowed) {
      console.log(`Skipping profile extraction for note ${noteId}: insufficient credits`);
      return;
    }

    const peopleList = matchedPeople.map((p) => p.canonical_name).join(", ");
    const cleanContent = stripHtmlIfNeeded(noteContent);
    const noteDateLine = noteDateISO ? `\nNote date: ${noteDateISO}` : "";
    const userPrompt = `People mentioned: ${peopleList}${noteDateLine}\n\nNote title: ${noteTitle}\nNote content:\n${cleanContent}`;

    let extractedFacts: Array<{
      contact_name: string;
      category_slug: string;
      label: string;
      value: string;
    }> = [];
    let extractedRelationships: Array<{
      person_a: string;
      person_b: string;
      label_a_to_b: string;
      label_b_to_a: string;
    }> = [];

    try {
      const result = await chatWithCredits(
        supabase, OPENROUTER_API_KEY, userId, "process-note-profile",
        [
          { role: "system", content: PROFILE_EXTRACTION_PROMPT },
          { role: "user", content: userPrompt },
        ],
        { response_format: { type: "json_object" } },
      );

      const rawContent = result.result.choices[0].message.content;
      console.log(`[profile-extract] Raw LLM response for note ${noteId}:`, rawContent);
      const parsed = JSON.parse(rawContent);

      // Normalize response shapes for facts
      let parseShape: string;
      if (Array.isArray(parsed)) {
        extractedFacts = parsed;
        parseShape = "array";
      } else if (typeof parsed === "object" && parsed !== null) {
        // New expected shape: { facts: [...], relationships: [...] }
        if (Array.isArray(parsed.facts)) {
          extractedFacts = parsed.facts;
          parseShape = "structured";
        } else {
          const arrayVal = Object.values(parsed).find((v) => Array.isArray(v)) as any[] | undefined;
          if (arrayVal) {
            extractedFacts = arrayVal;
            parseShape = "wrapped-array";
          } else if (parsed.contact_name && parsed.value) {
            extractedFacts = [parsed];
            parseShape = "single-object";
          } else {
            extractedFacts = [];
            parseShape = "invalid-object";
          }
        }

        // Extract relationships
        if (Array.isArray(parsed.relationships)) {
          extractedRelationships = parsed.relationships.filter(
            (r: any) => r.person_a && r.person_b && r.label_a_to_b
          ).map((r: any) => ({
            person_a: (r.person_a || "").trim(),
            person_b: (r.person_b || "").trim(),
            label_a_to_b: (r.label_a_to_b || "").trim().toLowerCase(),
            label_b_to_a: (r.label_b_to_a || r.label_a_to_b || "").trim().toLowerCase(),
          }));
        }
      } else {
        extractedFacts = [];
        parseShape = "invalid";
      }

      // Normalize string fields
      extractedFacts = extractedFacts.map((f: any) => ({
        contact_name: (f.contact_name || "").trim(),
        category_slug: (f.category_slug || "").trim().toLowerCase(),
        label: (f.label || "").trim(),
        value: (f.value || "").trim(),
      }));

      // Deterministic post-pass: derive Date of birth / Anniversary from age + ref date,
      // canonicalize aliased labels, and drop malformed birthday facts.
      extractedFacts = deriveCanonicalFacts(extractedFacts, noteDateISO);

      console.log(`[profile-extract] parseShape=${parseShape}, factsCount=${extractedFacts.length}, relationshipsCount=${extractedRelationships.length} for note ${noteId}`);
    } catch (err: any) {
      if (err.message === "INSUFFICIENT_CREDITS") {
        console.log(`Credit limit reached during profile extraction for note ${noteId}`);
        return;
      }
      console.error("Profile extraction LLM error:", err);
      return;
    }

    if (extractedFacts.length === 0) {
      console.log(`No profile facts extracted from note ${noteId} (0 after parsing)`);
      return;
    }

    // Filter to valid category slugs and match to contacts
    const nameToContact = new Map(
      matchedPeople.map((p) => [(p.canonical_name || p.name).toLowerCase(), p]),
    );
    // Also map by original extracted name
    for (const p of matchedPeople) {
      nameToContact.set(p.name.toLowerCase(), p);
    }

    const validFacts = extractedFacts.filter((f) => {
      if (!f.contact_name || !f.category_slug || !f.label || !f.value) return false;
      if (!PROFILE_CATEGORY_SLUGS.includes(f.category_slug)) {
        console.log(`[profile-extract] Dropping fact: invalid category_slug="${f.category_slug}"`);
        return false;
      }
      // Fuzzy match contact name against known contacts
      const exactMatch = nameToContact.has(f.contact_name.toLowerCase());
      if (exactMatch) return true;
      // Try fuzzy matching
      for (const [key, contact] of nameToContact) {
        if (isFuzzyMatch(f.contact_name, key)) {
          // Rewrite contact_name to canonical for downstream matching
          f.contact_name = contact.canonical_name;
          return true;
        }
      }
      console.log(`[profile-extract] Dropping fact: unmatched contact_name="${f.contact_name}"`);
      return false;
    });

    console.log(`[profile-extract] ${extractedFacts.length} parsed → ${validFacts.length} valid for note ${noteId}`);

    if (validFacts.length === 0) {
      return;
    }

    // Get existing profile entries for these contacts to avoid duplicates
    const contactIds = [...new Set(validFacts.map((f) => nameToContact.get(f.contact_name.toLowerCase())!.contact_id))];

    const { data: existingEntries } = await supabase
      .from("profile_entries")
      .select("contact_id, label, value, category_id")
      .eq("user_id", userId)
      .in("contact_id", contactIds);

    // Get existing categories for these contacts to map slugs to IDs
    const { data: existingCategories } = await supabase
      .from("profile_categories")
      .select("id, slug, contact_id")
      .eq("user_id", userId)
      .in("contact_id", contactIds);

    const entrySet = new Set(
      (existingEntries || []).map((e: any) => `${e.contact_id}|${e.label.toLowerCase()}|${e.value.toLowerCase()}`),
    );
    // Singleton-label set: (contact_id, label) — used to enforce one-value-per-label.
    const singletonEntrySet = new Set(
      (existingEntries || [])
        .filter((e: any) => SINGLETON_PROFILE_LABELS.has((e.label || "").toLowerCase()))
        .map((e: any) => `${e.contact_id}|${e.label.toLowerCase()}`),
    );

    // Check existing review_queue for duplicate profile suggestions
    const { data: existingQueueItems } = await supabase
      .from("review_queue")
      .select("payload, status")
      .eq("user_id", userId)
      .eq("suggestion_type", "add_profile_entry")
      .in("status", ["pending", "pending_review", "auto_applied_unreviewed", "kept", "blocked", "accepted", "dismissed"]);

    const queueSet = new Set(
      (existingQueueItems || []).map((q: any) =>
        `${q.payload.contact_id}|${(q.payload.label || "").toLowerCase()}|${(q.payload.value || "").toLowerCase()}`
      ),
    );
    // Singleton-label set for pending queue items.
    const singletonQueueSet = new Set(
      (existingQueueItems || [])
        .filter((q: any) =>
          SINGLETON_PROFILE_LABELS.has((q.payload.label || "").toLowerCase()) &&
          ["pending", "pending_review", "auto_applied_unreviewed", "kept", "accepted"].includes(q.status)
        )
        .map((q: any) => `${q.payload.contact_id}|${(q.payload.label || "").toLowerCase()}`),
    );

    const suggestions: ReviewSuggestion[] = [];
    const perContactCount = new Map<string, number>();

    for (const fact of validFacts) {
      const contact = nameToContact.get(fact.contact_name.toLowerCase())!;
      const labelLower = fact.label.toLowerCase();
      const dedupKey = `${contact.contact_id}|${labelLower}|${fact.value.toLowerCase()}`;
      const singletonKey = `${contact.contact_id}|${labelLower}`;

      // Skip if entry already exists or already in queue
      if (entrySet.has(dedupKey) || queueSet.has(dedupKey)) continue;

      // Singleton-label dedupe: only one Job title / Current city / etc. at a time.
      if (SINGLETON_PROFILE_LABELS.has(labelLower)) {
        if (singletonEntrySet.has(singletonKey) || singletonQueueSet.has(singletonKey)) {
          console.log(`[profile-extract] skipping fact: singleton label "${fact.label}" already pending/known for ${contact.canonical_name}`);
          continue;
        }
      }

      // Per-(contact, note) cap to prevent flooding.
      const count = perContactCount.get(contact.contact_id) || 0;
      if (count >= MAX_FACTS_PER_CONTACT_PER_NOTE) {
        console.log(`[profile-extract] cap reached for ${contact.canonical_name} on note ${noteId}, dropping further facts`);
        continue;
      }
      perContactCount.set(contact.contact_id, count + 1);

      // Find category ID if categories are seeded
      const catRow = (existingCategories || []).find(
        (c: any) => c.slug === fact.category_slug && c.contact_id === contact.contact_id,
      );

      suggestions.push({
        user_id: userId,
        source_note_id: noteId,
        suggestion_type: "add_profile_entry",
        title: `Add to ${contact.canonical_name}'s profile: ${fact.label}`,
        description: `"${fact.value}" — extracted from "${noteTitle}"`,
        payload: {
          contact_id: contact.contact_id,
          contact_name: contact.canonical_name,
          category_slug: fact.category_slug,
          category_id: catRow?.id || null,
          label: fact.label,
          value: fact.value,
        },
        status: "pending_review",
        target_entity_type: "profile_entry",
        source_title: noteTitle,
        extracted_value: `${fact.label}: ${fact.value}`,
        confidence_score: DEFAULT_CONFIDENCE.add_profile_entry,
        is_sensitive: isSensitiveSuggestion("add_profile_entry", fact as unknown as Record<string, unknown>, noteContent),
        suppression_key: buildSuppressionKey("add_profile_entry", "contact", contact.contact_id, `${fact.label}:${fact.value}`),
      });

      // Track to avoid duplicates within same batch
      queueSet.add(dedupKey);
      if (SINGLETON_PROFILE_LABELS.has(labelLower)) singletonQueueSet.add(singletonKey);
    }

    if (suggestions.length > 0) {
      const unsuppressed = await filterSuppressedSuggestions(userId, suggestions);
      const { error } = await supabase.from("review_queue").insert(unsuppressed);
      if (error) console.error("Profile suggestion insert error:", error);
      else console.log(`Created ${suggestions.length} profile suggestions for note ${noteId}`);
    } else {
      console.log(`All profile facts already known for note ${noteId}`);
    }

    // ── Relationship suggestions ──
    if (extractedRelationships.length > 0) {
      const relSuggestions: typeof suggestions = [];

      // Check existing relationship review queue items
      const { data: existingRelQueue } = await supabase
        .from("review_queue")
        .select("title, status")
        .eq("user_id", userId)
        .eq("suggestion_type", "add_relationship")
        .in("status", ["pending", "pending_review", "auto_applied_unreviewed", "kept", "blocked", "accepted", "dismissed"]);

      const relQueueSet = new Set(
        (existingRelQueue || []).map((q: any) => q.title)
      );

      for (const rel of extractedRelationships) {
        // Resolve person_a and person_b to contacts
        const isSelfA = /^(me|myself|i)$/i.test(rel.person_a);
        const isSelfB = /^(me|myself|i)$/i.test(rel.person_b);

        let contactA: { id: string; name: string } | null = null;
        let contactB: { id: string; name: string } | null = null;

        if (!isSelfA) {
          // Find contact for person_a
          const matchA = nameToContact.get(rel.person_a.toLowerCase());
          if (matchA) contactA = { id: matchA.contact_id, name: matchA.canonical_name };
          else {
            // Fuzzy match
            for (const [key, c] of nameToContact) {
              if (isFuzzyMatch(rel.person_a, key)) {
                contactA = { id: c.contact_id, name: c.canonical_name };
                break;
              }
            }
          }
          if (!contactA) {
            console.log(`[relationships] Skipping: cannot match person_a="${rel.person_a}"`);
            continue;
          }
        }

        if (!isSelfB) {
          const matchB = nameToContact.get(rel.person_b.toLowerCase());
          if (matchB) contactB = { id: matchB.contact_id, name: matchB.canonical_name };
          else {
            for (const [key, c] of nameToContact) {
              if (isFuzzyMatch(rel.person_b, key)) {
                contactB = { id: c.contact_id, name: c.canonical_name };
                break;
              }
            }
          }
          if (!contactB) {
            console.log(`[relationships] Skipping: cannot match person_b="${rel.person_b}"`);
            continue;
          }
        }

        // Can't have both be self
        if (isSelfA && isSelfB) continue;

        const nameA = isSelfA ? "Me" : contactA!.name;
        const nameB = isSelfB ? "Me" : contactB!.name;
        const title = `Add relationship: ${nameA} → ${nameB} (${rel.label_a_to_b})`;

        if (relQueueSet.has(title)) continue;

        relSuggestions.push({
          user_id: userId,
          source_note_id: noteId,
          suggestion_type: "add_relationship",
          title,
          description: `${nameA} is ${rel.label_a_to_b} of ${nameB}`,
          payload: {
            source_type: isSelfA ? "self" : "contact",
            source_id: isSelfA ? null : contactA!.id,
            target_type: isSelfB ? "self" : "contact",
            target_id: isSelfB ? null : contactB!.id,
            label: rel.label_a_to_b,
            inverse_label: rel.label_b_to_a,
            inverse_source_type: isSelfB ? "self" : "contact",
            inverse_source_id: isSelfB ? null : contactB!.id,
            inverse_target_type: isSelfA ? "self" : "contact",
            inverse_target_id: isSelfA ? null : contactA!.id,
            contact_name_a: nameA,
            contact_name_b: nameB,
          },
          status: "pending_review",
          target_entity_type: "relationship",
          source_title: noteTitle,
          extracted_value: `${nameA} ${rel.label_a_to_b} ${nameB}`,
          confidence_score: DEFAULT_CONFIDENCE.add_relationship,
          is_sensitive: isSensitiveSuggestion("add_relationship", { ...rel, nameA, nameB }, noteContent),
          suppression_key: buildSuppressionKey("add_relationship", "relationship", null, `${nameA}:${rel.label_a_to_b}:${nameB}`),
        });
        relQueueSet.add(title);
      }

      if (relSuggestions.length > 0) {
        const unsuppressed = await filterSuppressedSuggestions(userId, relSuggestions);
        const { error } = await supabase.from("review_queue").insert(unsuppressed);
        if (error) console.error("Relationship suggestion insert error:", error);
        else console.log(`Created ${relSuggestions.length} relationship suggestions for note ${noteId}`);
      }
    }
  } catch (err) {
    console.error("generateProfileSuggestions error:", err);
  }
}

/* ── Main background processor ── */
async function processInBackground(noteId: string, authHeader: string) {
  try {
    const { data: note, error: fetchErr } = await supabase
      .from("notes")
      .select("id, title, content, user_id, metadata, source_app, is_external, ai_visibility, created_at")
      .eq("id", noteId)
      .single();

    if (fetchErr || !note) {
      console.error("Note not found:", noteId);
      return;
    }

    const aiHidden = (note as any).ai_visibility === "hidden";

    let fullText = `${note.title}\n\n${note.content}`.trim();
    if (!fullText) return;

    // Include media analysis content in the embedding text
    const { data: mediaEntries } = await supabase
      .from("media_analysis")
      .select("extracted_text, description, topics")
      .eq("note_id", noteId)
      .eq("analysis_status", "complete");

    const mediaTopics: string[] = [];
    if (mediaEntries && mediaEntries.length > 0) {
      const mediaTexts = mediaEntries.map((m: any) => {
        if (m.topics) mediaTopics.push(...m.topics);
        return [m.description, m.extracted_text].filter(Boolean).join(" ");
      });
      fullText += "\n\n[Media content]\n" + mediaTexts.join("\n");
    }

    // Pre-check balance before making any LLM calls
    const balance = await checkBalance(supabase, note.user_id);
    if (!balance.allowed) {
      console.log(`Skipping AI processing for note ${noteId}: insufficient credits for user ${note.user_id}`);
      return;
    }

    // Extract metadata first (single chat call). Embeddings are produced via
    // chunking below so long notes are not silently truncated.
    let embedding: number[] | null = null;
    let metadata: Record<string, unknown> = {};
    let chunkInfo: { count: number; truncated: boolean; failures: number } = {
      count: 0, truncated: false, failures: 0,
    };

    try {
      const chatResult = await chatWithCredits(
        supabase, OPENROUTER_API_KEY, note.user_id, "process-note",
        [
          { role: "system", content: METADATA_SYSTEM_PROMPT },
          { role: "user", content: fullText.slice(0, 24000) },
        ],
        { response_format: { type: "json_object" } }
      );

      try {
        metadata = JSON.parse(chatResult.result.choices[0].message.content);
      } catch {
        metadata = { topics: ["uncategorized"], type: "observation", sentiment: "neutral" };
      }

      // Smart-chunk the note and embed each chunk. The note-level embedding is
      // taken from the first chunk so existing note-level vector search keeps
      // working, while the per-chunk embeddings power the new RAG retrieval.
      const chunkResult = await embedAndStoreNoteChunks(
        supabase, OPENROUTER_API_KEY, note.user_id, noteId, note.title, fullText, "process-note",
      );
      embedding = chunkResult.firstChunkEmbedding;
      chunkInfo = {
        count: chunkResult.chunkCount,
        truncated: chunkResult.truncated,
        failures: chunkResult.failures,
      };
    } catch (err: any) {
      if (err.message === "INSUFFICIENT_CREDITS") {
        console.log(`Credit limit reached during processing of note ${noteId}`);
        return;
      }
      throw err;
    }

    // Merge media-derived topics into note metadata
    if (mediaTopics.length > 0 && Array.isArray(metadata.topics)) {
      const existingTopics = metadata.topics as string[];
      const merged = [...new Set([...existingTopics, ...mediaTopics])];
      metadata.topics = merged;
    }

    // Auto-link metadata people to contacts (alias-aware) + self-recognition
    const metadataPeople = Array.isArray(metadata.people) ? metadata.people as string[] : [];
    const contactMap: Record<string, string> = {};
    const matchedPeople: Array<{ name: string; contact_id?: string; canonical_name?: string; is_self?: boolean }> = [];
    const ambiguousMentions: Array<{ name: string; candidates: Array<{ id: string; name: string }> }> = [];
    const selfCtx = await loadSelfContext(note.user_id);
    const noteFullText = `${note.title}\n${note.content}`;

    if (metadataPeople.length > 0) {
      const { data: allContacts } = await supabase
        .from("contacts")
        .select("id, name, aliases")
        .eq("user_id", note.user_id)
        .is("merged_into", null);

      const nameToContact = new Map<string, { id: string; name: string }>();
      for (const c of (allContacts || []) as any[]) {
        nameToContact.set(c.name.toLowerCase(), { id: c.id, name: c.name });
        if (Array.isArray(c.aliases)) {
          for (const alias of c.aliases) {
            if (alias) nameToContact.set(alias.toLowerCase(), { id: c.id, name: c.name });
          }
        }
      }

      for (const person of metadataPeople) {
        // Collect candidate contacts (exact or fuzzy on first name)
        const candidates: Array<{ id: string; name: string }> = [];
        const exact = nameToContact.get(person.toLowerCase());
        if (exact) candidates.push(exact);
        if (candidates.length === 0) {
          for (const [key, contact] of nameToContact) {
            if (isFuzzyMatch(person, key)) { candidates.push(contact); break; }
          }
        }

        const recalled = selfCtx.enabled && nameMatchesAlias(person, selfCtx.aliases)
          ? await recallDisambiguation(note.user_id, person)
          : null;

        let decision: SelfDecision;
        if (recalled?.target === "self") {
          decision = { kind: "self", contactCandidates: [], reason: "recalled_self" };
        } else if (recalled?.target === "contact" && recalled.contact_id) {
          const c = candidates.find((x) => x.id === recalled.contact_id) || { id: recalled.contact_id, name: person };
          decision = { kind: "contact", contactCandidates: [c], reason: "recalled_contact" };
        } else {
          decision = disambiguateMention(person, noteFullText, selfCtx, candidates, selfCtx.preferredName);
        }

        if (decision.kind === "self") {
          matchedPeople.push({ name: person, is_self: true, canonical_name: selfCtx.preferredName || person });
          await recordDisambiguation(note.user_id, person, "self", null, 0.7);
        } else if (decision.kind === "contact" && decision.contactCandidates.length > 0) {
          const c = decision.contactCandidates[0];
          matchedPeople.push({ name: person, contact_id: c.id, canonical_name: c.name });
          await recordDisambiguation(note.user_id, person, "contact", c.id, 0.7);
        } else if (decision.kind === "ambiguous") {
          ambiguousMentions.push({ name: person, candidates: decision.contactCandidates });
        }
        // decision.kind === "skip" → no action; "Add to People" flow handles unknown names.
      }
      if (matchedPeople.length > 0) {
        metadata.matched_people = matchedPeople;
      }

      // Build contact map for action items
      for (const [name, contact] of nameToContact) {
        contactMap[name] = contact.id;
      }
    }

    // Surface ambiguous self/contact collisions for user review
    if (ambiguousMentions.length > 0) {
      try {
        const items = ambiguousMentions.map((m) => {
          const candidateLabel = m.candidates.map((c) => c.name).join(", ") || "another person";
          return {
            user_id: note.user_id,
            source_note_id: noteId,
            suggestion_type: "name_disambiguation",
            title: `"${m.name}" in "${note.title}" — is this you or ${candidateLabel}?`,
            description: `We're not sure if "${m.name}" refers to you (${selfCtx.preferredName || "yourself"}) or ${candidateLabel}.`,
            payload: { mention: m.name, candidates: m.candidates, preferred_name: selfCtx.preferredName },
            status: "pending_review",
            target_entity_type: null,
            source_title: note.title,
            extracted_value: m.name,
            confidence_score: 0.5,
            is_sensitive: false,
            suppression_key: buildSuppressionKey("name_disambiguation", null, null, m.name),
          };
        });
        await supabase.from("review_queue").insert(items);
      } catch (e) {
        console.error("ambiguous mention insert error:", e);
      }
    }

    // Only use AI-generated title for quick-capture notes (where the user didn't write the title).
    // Never overwrite a user-authored title.
    const existingMeta = (note.metadata as Record<string, unknown> | null) ?? {};
    const isQuickCapture = existingMeta?.is_quick_capture === true;
    const aiTitle = isQuickCapture && typeof metadata.title === "string" && metadata.title.trim()
      ? metadata.title.trim()
      : null;

    // Merge AI-derived metadata onto existing keys so per-source fields like
    // web_clip, source, is_quick_capture, etc. survive enrichment.
    const mergedMetadata = {
      ...existingMeta,
      ...metadata,
      chunking: { count: chunkInfo.count, truncated: chunkInfo.truncated, failures: chunkInfo.failures, updated_at: new Date().toISOString() },
    };

    // Update the note with embedding, metadata, and optionally a smarter title
    const updatePayload: Record<string, unknown> = { embedding, metadata: mergedMetadata };
    if (aiTitle) updatePayload.title = aiTitle;

    const { error: updateErr } = await supabase
      .from("notes")
      .update(updatePayload)
      .eq("id", noteId);

    if (updateErr) {
      console.error("Update error:", updateErr);
      return;
    }

    // AI-hidden notes: keep embeddings (local search) but skip every downstream
    // AI surface — review queue, profile suggestions, knowledge graph connections.
    if (aiHidden) {
      console.log("process-note: skipping AI-derivative work, note is ai_visibility=hidden:", noteId);
      return;
    }

    // Generate review queue suggestions (no extra LLM calls)
    await generateReviewItems(note.user_id, noteId, note.title, note.content, mergedMetadata);

    // Generate profile suggestions for matched people (one extra LLM call)
    await generateProfileSuggestions(note.user_id, noteId, note.title, note.content, matchedPeople, {
      source_app: (note as any).source_app,
      is_external: (note as any).is_external,
      metadata: mergedMetadata,
    });

    // Trigger connection computation (fire-and-forget)
    const computeUrl = `${SUPABASE_URL}/functions/v1/compute-connections`;
    fetch(computeUrl, {
      method: "POST",
      headers: {
        Authorization: authHeader,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ note_id: noteId }),
    }).catch(err => console.error("compute-connections trigger error:", err));

    console.log("process-note completed for:", noteId, "remaining credits:", lastCredits?.remaining_credits);
  } catch (err) {
    console.error("Background processing error:", err);
  }
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { note_id } = await req.json();
    if (!note_id) {
      return new Response(JSON.stringify({ error: "note_id required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // @ts-expect-error EdgeRuntime is a Supabase global not in TS scope
    EdgeRuntime.waitUntil(processInBackground(note_id, authHeader));

    return new Response(JSON.stringify({ ok: true, processing: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("Function error:", err);
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : "Internal error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
