import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  checkBalance,
  insufficientCreditsResponse,
} from "../_shared/llm-credits.ts";
import { runChat } from "../_shared/llm-router.ts";
import { embedAndStoreNoteChunks } from "../_shared/chunk-embeddings.ts";
import {
  canonicalLabel,
  inverseLabel,
  isSymmetricLabel,
  relationshipPairKey,
  type EntityRef,
} from "../_shared/relationship-canonical.ts";
import {
  BLOCKED_LABELS_FOR_PROMPT,
  CANONICAL_LABELS_FOR_PROMPT,
  PROFILE_CANONICAL_SCHEMA,
  blockedLabelAsRelationship,
  canonicalProfileLabel,
  correctProfileCategory,
  isBlockedProfileLabel,
  normalizeProfileValueForDedup,
} from "../_shared/profile-canonical-schema.ts";
import {
  applyNormalization,
  createNormalizationSuggestions,
} from "../_shared/profile-normalization.ts";
import {
  buildProfileTokenIndex,
  dedupIncomingProfileValue,
} from "../_shared/profile-dedup.ts";

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
    .select("suggestion_mode, suggestion_sensitivity, auto_add_sensitive, person_blocklist, profile_language")
    .eq("user_id", userId)
    .maybeSingle();

  return {
    mode: (data as any)?.suggestion_mode || "auto",
    sensitivity: (data as any)?.suggestion_sensitivity || "balanced",
    profileLanguage: String((data as any)?.profile_language || "English"),
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
  const threshold = thresholdFor(suggestion.suggestion_type, preferences.sensitivity);
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
      const contactIdRaw = suggestion.payload.contact_id as string | null | undefined;
      const contactId: string | null = contactIdRaw || null;
      const categorySlug = suggestion.payload.category_slug as string | undefined;
      let categoryId = suggestion.payload.category_id as string | null | undefined;
      const label = String(suggestion.payload.label || "").trim();
      const value = String(suggestion.payload.value || "").trim();
      if (!label || !value || !categorySlug) return { ...suggestion, status: "pending_review" };

      // Resolve / create the category. Owner categories have contact_id IS NULL.
      if (!categoryId) {
        const baseQuery = supabase
          .from("profile_categories")
          .select("id")
          .eq("user_id", suggestion.user_id)
          .eq("slug", categorySlug);
        const { data: existingCat } = contactId
          ? await baseQuery.eq("contact_id", contactId).maybeSingle()
          : await baseQuery.is("contact_id", null).maybeSingle();
        if (existingCat?.id) {
          categoryId = existingCat.id;
        } else {
          const { data: newCat, error: catErr } = await supabase
            .from("profile_categories")
            .insert({
              user_id: suggestion.user_id,
              contact_id: contactId,
              slug: categorySlug,
              name: categorySlug.charAt(0).toUpperCase() + categorySlug.slice(1),
              icon: "folder",
              is_default: false,
              sort_order: 99,
              visibility_scope: "all",
            } as any)
            .select("id")
            .maybeSingle();
          if (catErr && (catErr as any).code !== "23505") {
            return { ...suggestion, status: "pending_review" };
          }
          if (newCat?.id) {
            categoryId = newCat.id;
          } else {
            const baseQuery2 = supabase
              .from("profile_categories")
              .select("id")
              .eq("user_id", suggestion.user_id)
              .eq("slug", categorySlug);
            const { data: raced } = contactId
              ? await baseQuery2.eq("contact_id", contactId).maybeSingle()
              : await baseQuery2.is("contact_id", null).maybeSingle();
            categoryId = raced?.id || null;
          }
        }
      }
      if (!categoryId) return { ...suggestion, status: "pending_review" };

      const { data, error } = await supabase
        .from("profile_entries")
        .insert({ user_id: suggestion.user_id, contact_id: contactId, category_id: categoryId, label, value, sort_order: 0 })
        .select("id")
        .single();
      if (error && (error as any).code === "23505") return { ...suggestion, status: "removed" };
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

    if (suggestion.suggestion_type === "add_moment") {
      const p = suggestion.payload as any;
      const happenedAt = String(p.happened_at || "").trim();
      const title = String(p.title || "").trim();
      if (!happenedAt || !title) return { ...suggestion, status: "pending_review" };
      const participants: Array<{ contact_id?: string | null; is_self?: boolean; name?: string }> = Array.isArray(p.participants) ? p.participants : [];
      const firstContactParticipant = participants.find((x) => x.contact_id);
      const personId = firstContactParticipant?.contact_id || null;
      const { data: insertedMoment, error: momentErr } = await supabase
        .from("moments")
        .insert({
          user_id: suggestion.user_id,
          title,
          description: p.description || null,
          happened_at: happenedAt,
          impact_level: Math.max(1, Math.min(4, Number(p.impact_level) || 2)),
          confidence_date: Math.max(0, Math.min(10, Number(p.confidence_date) || 7)),
          confidence_truth: Math.max(0, Math.min(10, Number(p.confidence_truth) || 7)),
          person_id: personId,
          source: "note_auto",
          status: "past_fact",
        } as any)
        .select("id")
        .single();
      if (momentErr || !insertedMoment) {
        console.error("[auto-apply moment] insert failed:", momentErr, "payload:", JSON.stringify({ user_id: suggestion.user_id, title, happenedAt, personId, impact: p.impact_level, confidence_date: p.confidence_date, confidence_truth: p.confidence_truth }));
        return { ...suggestion, status: "pending_review" };
      }
      const participantRows = participants
        .filter((x) => x.contact_id)
        .map((x) => ({ moment_id: insertedMoment.id, person_id: x.contact_id }));
      if (participantRows.length > 0) {
        await supabase.from("moment_participants").insert(participantRows as any);
      }
      return { ...suggestion, status: "auto_applied_unreviewed", target_entity_id: insertedMoment.id, applied_at: new Date().toISOString() };
    }

    if (suggestion.suggestion_type === "normalize_profile_entry") {
      const payload = suggestion.payload as any;
      const result = await applyNormalization(supabase, payload);
      if (result.ok && result.entryId) {
        return { ...suggestion, status: "auto_applied_unreviewed", target_entity_id: result.entryId, applied_at: new Date().toISOString() };
      }
      // Stale / failed → let the human decide.
      return { ...suggestion, status: "pending_review" };
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
- "people": array of names of REAL human beings the note author actually knows of or interacts with (real individuals — first name, full name, or known alias). Do NOT include:
    * companies, products, apps, projects, tools, libraries, websites, brands, domains, or open-source repos, even if the name sounds personal.
    * fictional characters from novels, light novels, manga, anime, visual novels, video games, films, TV series, comics, plays, or any other work of fiction — even if the note lists them by name. This applies EVEN when the surrounding note is a personal profile or journal that only references media in passing. Examples that must be EXCLUDED:
        - "favorite actor Lee Junyoung as Geum Sung-je" → exclude "Geum Sung-je" (that's the fictional role, not a person the author knows).
        - "the character I remind you of? Spiderman?" → exclude "Spiderman" (fictional superhero).
        - "currently watching Weak Hero, love the protagonist" / "cast: A, B, C" / "playing Chocola in NEKOPARA" → exclude character names.
      Real actors, directors, authors, streamers, or creators the author actually follows or knows MAY be included — but the fictional role they play must not.
    * mythological, religious, or folkloric figures presented as characters.
  When in doubt (a single capitalized word with no clearly human context, or a name that only appears as part of describing a story/game/show), leave it out.
- "mentioned_works": array of titles of creative works discussed in the note (novels, manga, anime, games, films, shows, albums, etc.). Empty if none.
- "content_mode": one of "personal" (default — a personal note, journal entry, meeting note, task, idea, etc.), "review_of_fiction" (the primary subject is a work of fiction — reviewing/summarizing/discussing a novel, anime, manga, game, film, TV show, etc.), "review_of_nonfiction" (primary subject is a non-fiction book, article, documentary, course), or "reference" (a reference/how-to/documentation clip). Choose "review_of_fiction" whenever the note is mainly ABOUT a fictional work, regardless of length.
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

// Per-suggestion-type thresholds. Profile entries are low-risk and reversible,
// so they get a more permissive policy than identity-altering actions.
const AUTO_APPLY_THRESHOLDS: Record<string, Record<string, number>> = {
  add_profile_entry: { conservative: 0.78, balanced: 0.65, exploratory: 0.5 },
  add_relationship: { conservative: 0.80, balanced: 0.7, exploratory: 0.55 },
  add_moment: { conservative: 0.85, balanced: 0.75, exploratory: 0.6 },
  // Destructive: stricter so low-confidence merges wait for human review even in auto mode.
  normalize_profile_entry: { conservative: 0.92, balanced: 0.85, exploratory: 0.75 },
};

function thresholdFor(suggestionType: string, sensitivity: string): number {
  const perType = AUTO_APPLY_THRESHOLDS[suggestionType];
  if (perType && perType[sensitivity] !== undefined) return perType[sensitivity];
  return SENSITIVITY_THRESHOLDS[sensitivity] ?? SENSITIVITY_THRESHOLDS.balanced;
}

const DEFAULT_CONFIDENCE: Record<string, number> = {
  add_contact: 0.8,
  add_alias: 0.78,
  add_profile_entry: 0.80,
  add_relationship: 0.72,
  add_moment: 0.78,
  normalize_profile_entry: 0.8,
};

const SENSITIVE_TERMS = [
  "medical", "health", "diagnosis", "condition", "therapy", "depression", "anxiety", "mental",
  "pregnant", "pregnancy", "romantic", "sexual", "affair", "secret", "conflict", "legal", "lawsuit",
  "debt", "bankrupt", "financial hardship", "broke", "divorce", "addiction", "trauma",
];

const PROFILE_EXTRACTION_PROMPT = `You are extracting biographical facts about specific real people from a personal note (which may include OCR text from attached images/documents).

Return a JSON object with two keys:
1. "facts": an array of profile fact objects, each with:
   - "contact_name": the person's name exactly as provided. For first-person facts about the note author (the OWNER themself), use the literal string "me".
   - "category_slug": one of: ${PROFILE_CATEGORY_SLUGS.join(", ")}
   - "label": a short label for the fact (e.g. "Favorite cuisine", "Current city", "Job title", "Wedding date", "Spouse")
   - "value": the actual value (e.g. "Japanese", "Berlin", "Software Engineer", "2006-01-23", "Xihui")

2. "relationships": an array of relationship objects, each with:
   - "person_a": name of the first person
   - "person_b": name of the second person (can be "me" or "myself" if referring to the note author)
   - "label_a_to_b": what person_a is to person_b (e.g. "employee", "brother", "friend", "mentor", "spouse")
   - "label_b_to_a": what person_b is to person_a

OWNER-FACT GUIDANCE:
- The note author / profile owner is the user. Extract facts about THEM into the OWNER profile by setting contact_name = "me".
- Owner facts may come from first-person language ("I am", "my", "I live in"), the owner's own name/aliases listed in the user prompt, or scanned documents/IDs/certificates clearly belonging to the owner.
- A wedding/marriage event (in the note text OR in attached document OCR) is an owner fact: emit {contact_name:"me", category_slug:"relationships", label:"Wedding date", value:"YYYY-MM-DD"} AND a relationship (person_a:"me", person_b:<spouse name>, label_a_to_b:"spouse", label_b_to_a:"spouse"). Also emit a Wedding date fact for the spouse.

CRITICAL — DO NOT EXTRACT FACTS WHEN:
- The person appears only as the author / byline / source / "by X" / "via X" / link metadata of the content.
- The person is the subject of a third-party article, prompt template, course, product description, or job posting where the role described belongs to the content.
- The note is a prompt library, template, documentation, code snippet, or generic reference where the person is only tangentially named.
- A fact would be inferred only from indirect mentions, quotes, or generic context.

Rules:
- Extract facts/relationships clearly stated or strongly implied about the person themselves
- Do NOT invent or assume — if unsure, skip
- Return empty arrays if nothing qualifies
- For relationships, use standard labels: employee, employer, friend, brother, sister, mother, father, son, daughter, partner, spouse, mentor, mentee, manager, report, co-worker, neighbor, roommate, client, provider, teacher, student

DERIVED FACTS — compute the canonical underlying fact when possible:
- If the note states an age AND a reference date, compute date of birth: label = "Date of birth", value = "YYYY-MM-DD" (year = referenceYear - age).
- If the note states a wedding anniversary in the same shape, derive label = "Anniversary", value = "YYYY-MM-DD".
- If you cannot derive an exact ISO date confidently, do NOT emit a Birthday/Anniversary fact.
- Always normalize date values to ISO YYYY-MM-DD.
- The "value" must contain ONLY the fact itself. Strip editorial, joking, or parenthetical commentary: emit 5'4", NOT 5'4" (fun sized).

CANONICAL LABELS — prefer these EXACT label names when one fits the fact:
${CANONICAL_LABELS_FOR_PROMPT}
When one of these canonical labels fits the fact, USE IT EXACTLY. Only invent a new label if none fits. For open-ended categories (personality, principles, hobbies, food, entertainment, travel, goals, preferences) keep using natural labels — do not force them onto this list. Do NOT deduplicate or drop facts; still extract everything you find — labeling is normalized downstream.`;

// Singleton labels = labels with at most one truth per subject. Derived from
// the shared canonical schema so the two stay in sync. Legacy alias forms are
// also included so pre-canonicalization dedup still works.
const SINGLETON_PROFILE_LABELS = new Set<string>([
  // Legacy / pre-canonical alias forms still seen in storage:
  "job title", "current job title", "role", "title",
  "company", "current company", "employer",
  "current city", "city", "location",
  "birthday", "date of birth", "dob", "geburtstag", "geburtsdatum",
  "pronouns", "nationality",
  "partner", "spouse",
]);
// Add every canonical single-value label from the shared schema.
for (const schema of Object.values(PROFILE_CANONICAL_SCHEMA)) {
  for (const def of schema.labels) {
    if (def.single) SINGLETON_PROFILE_LABELS.add(def.canonical.toLowerCase());
  }
}

function canonicalizeLabel(label: string, categorySlug = "identity"): string {
  return canonicalProfileLabel(categorySlug, label);
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

      // Couldn't derive a clean ISO date — keep the fact under a non-singleton
      // "Birthday" label so the user sees it in review and can decide.
      out.push({ ...f, label: "Birthday", value });
      continue;
    }

    // Generic label canonicalization for non-birthday facts.
    out.push({ ...f, label: canonicalizeLabel(label, f.category_slug) });
  }
  return out;
}

// Removed: NON_BIOGRAPHICAL_SOURCES blanket skip. Use SOFT_SIGNAL_SOURCES
// below instead — extraction still runs but confidence is capped.

const MAX_FACTS_PER_CONTACT_PER_NOTE = 8;

// Sources where extraction still runs but confidence is capped so facts require
// user review rather than auto-applying. These often contain mixed signal
// (web clips, GitHub READMEs, etc.) — biographical facts can appear but
// shouldn't be trusted blindly.
const SOFT_SIGNAL_SOURCES = new Set([
  "querino", "github", "singlefile", "web-clip", "webclip",
  "slack-public-channel",
]);
const SOFT_SIGNAL_CONFIDENCE_CAP = 0.7;

/* ── Fictional-character guard (per-name) ─────────────────────────────────────
 * The metadata pass sometimes leaks fictional characters into `people` even
 * when the note isn't a "review_of_fiction". These helpers reject a name
 * either by hard match against iconic characters or by inspecting the
 * surrounding text for role/casting/media cues.
 */
const FICTIONAL_CHARACTER_BLOCKLIST = new Set([
  // Superheroes / comics
  "spiderman", "spider-man", "spider man", "peter parker",
  "batman", "bruce wayne", "superman", "clark kent", "wonder woman",
  "iron man", "tony stark", "captain america", "steve rogers", "thor",
  "hulk", "black widow", "hawkeye", "deadpool", "wolverine", "storm",
  "aquaman", "flash", "green lantern", "catwoman", "joker", "harley quinn",
  // Anime / manga / games
  "naruto", "sasuke", "sakura", "kakashi", "goku", "vegeta", "luffy",
  "zoro", "sanji", "ichigo", "eren", "mikasa", "levi", "light yagami",
  "l lawliet", "kirito", "asuna", "saber", "rem", "emilia", "zero two",
  "sailor moon", "usagi", "pikachu", "ash ketchum", "mario", "luigi",
  "peach", "bowser", "yoshi", "link", "zelda", "ganon", "samus",
  "kratos", "master chief", "geralt", "cloud strife", "sephiroth",
  "chocola", "vanilla", "nekopara",
  // Star Wars / fantasy
  "luke skywalker", "darth vader", "yoda", "obi-wan", "han solo",
  "leia", "rey", "kylo ren", "gandalf", "frodo", "aragorn", "legolas",
  "harry potter", "hermione", "voldemort", "dumbledore",
  // Common cartoon
  "mickey mouse", "donald duck", "bugs bunny", "snoopy",
]);

const FICTION_CONTEXT_RE = /\b(as|playing|plays|voiced by|voice(?:d)?|role of|the character|character|protagonist|antagonist|villain|main lead|main cast|cast:|starring|hero|heroine|OC|fictkin|kin|waifu|husbando|from the (?:show|series|anime|manga|game|movie|film|book|novel))\b/i;
const FICTION_LIST_CUES_RE = /\b(favorite (?:show|movie|film|anime|manga|series|game|character|actor|band)|currently (?:watching|reading|playing)|watch(?:ing|list)|read(?:ing|list)|play(?:ing|list)|episode|season|chapter|manhwa|manhua|light novel|visual novel|otome|jrpg|VN)\b/i;

/** Find the sentence/window around a name mention (case-insensitive). */
function contextAround(name: string, text: string, radius = 140): string | null {
  if (!name || !text) return null;
  const hay = text.toLowerCase();
  const needle = name.toLowerCase();
  const idx = hay.indexOf(needle);
  if (idx < 0) return null;
  const start = Math.max(0, idx - radius);
  const end = Math.min(text.length, idx + needle.length + radius);
  return text.slice(start, end);
}

/** Deterministic per-name fiction check. Returns a reason string when the name
 * looks fictional, or null when it looks fine to keep. */
function detectFictionalMention(name: string, text: string): string | null {
  const norm = name.toLowerCase().trim();
  if (!norm) return null;
  if (FICTIONAL_CHARACTER_BLOCKLIST.has(norm)) return "iconic fictional character";
  const compact = norm.replace(/[-\s]+/g, "");
  if (FICTIONAL_CHARACTER_BLOCKLIST.has(compact)) return "iconic fictional character";

  const ctx = contextAround(name, text);
  if (!ctx) return null;

  // Strong cue: "actor X as Name" / "playing Name" / "as Name (role)" / "voiced by X"
  const nameEsc = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const asRoleRe = new RegExp(`\\b(?:as|playing|plays|role of|voiced by|voice actor)\\s+${nameEsc}\\b`, "i");
  if (asRoleRe.test(ctx)) return "appears as a role/character in surrounding text";
  const nameAsRe = new RegExp(`\\b${nameEsc}\\s*[,(]?\\s*(?:the )?(?:protagonist|antagonist|villain|main character|character|hero|heroine|main lead)\\b`, "i");
  if (nameAsRe.test(ctx)) return "described as a character in surrounding text";

  // Combined: fiction context cue + list/media cue in the same window
  if (FICTION_CONTEXT_RE.test(ctx) && FICTION_LIST_CUES_RE.test(ctx)) {
    return "mentioned inside a media/fiction list";
  }
  return null;
}

/** LLM verification: classify a batch of candidate new-people names as
 * real vs fictional given short context snippets from the note. Returns a
 * Set of names the LLM verdicted as `real_person`. On any failure, returns
 * a permissive Set (all names allowed) so we don't break the pipeline. */
async function verifyRealPeopleWithLLM(
  userId: string,
  noteTitle: string,
  noteText: string,
  candidates: string[],
): Promise<Set<string>> {
  const allowAll = new Set(candidates.map((n) => n.toLowerCase()));
  if (candidates.length === 0) return allowAll;
  try {
    const snippets = candidates.map((n) => {
      const ctx = contextAround(n, noteText, 200) || "(no context found)";
      return `- ${n}: "${ctx.replace(/\s+/g, " ").trim()}"`;
    }).join("\n");
    const userPrompt = `Note title: ${noteTitle}\n\nCandidate names extracted from this note (each with surrounding text):\n${snippets}\n\nFor EACH candidate, decide whether it is a REAL person the note's author knows or interacts with, or a FICTIONAL character (from a novel, anime, manga, game, film, TV show, comic, etc.), or UNCLEAR. Actors/creators/streamers count as real; the roles they play do not. Return strict JSON: {"verdicts":[{"name":"...","verdict":"real_person"|"fictional_character"|"unclear"}]}`;
    const result = await runChat({
      db: supabase,
      userId,
      callSite: "process-note.fiction_guard",
      messages: [{ role: "user", content: userPrompt }],
      defaults: {
        provider: "openrouter",
        model: "deepseek/deepseek-v4-flash",
        systemPrompt: "You classify whether extracted names refer to real people the note's author knows, or to fictional characters. Be strict: when the surrounding text frames the name as a character, role, or media reference, mark it fictional. When context is thin, mark it unclear. Output valid JSON only.",
      },
      callOptions: { response_format: { type: "json_object" } },
    });
    const parsed = JSON.parse(result.content || "{}");
    const verdicts = Array.isArray(parsed?.verdicts) ? parsed.verdicts : [];
    const real = new Set<string>();
    for (const v of verdicts) {
      if (v && typeof v.name === "string" && v.verdict === "real_person") {
        real.add(String(v.name).toLowerCase());
      }
    }
    // If the LLM returned nothing usable, fall back to permissive to avoid regressions.
    if (real.size === 0 && verdicts.length === 0) return allowAll;
    return real;
  } catch (err) {
    console.error("[fiction_guard] LLM verification failed, allowing all candidates:", err);
    return allowAll;
  }
}

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

    // Fiction guard — when the note is primarily about a work of fiction (novel,
    // anime, manga, game, film, TV, etc.), the "people" list from the metadata
    // pass is almost certainly a cast of characters, not real contacts. Skip
    // add_contact / add_alias suggestions in that case. Heuristic backup: even
    // if the LLM missed `content_mode`, look for strong fiction cues in the text.
    const contentMode = typeof metadata.content_mode === "string" ? metadata.content_mode : "personal";
    const fictionCueRe = /\b(novel|light novel|visual novel|manga|manhwa|manhua|anime|light[- ]?novel|graphic novel|comic(?:s|book)?|video ?game|jrpg|otome|dating sim|movie|film|tv series|tv show|series|episode|season|character|protagonist|antagonist|author|writer|director|studio ghibli|main cast|voice actor|voice cast)\b/i;
    const noteFictionText = `${noteTitle}\n${noteContent}`;
    const looksLikeFiction = contentMode === "review_of_fiction" || (contentMode !== "personal" && fictionCueRe.test(noteFictionText));
    const skipPersonSuggestions = contentMode === "review_of_fiction";
    if (skipPersonSuggestions) {
      console.log(`[process-note] Skipping add_contact/add_alias suggestions for note ${noteId} — content_mode=${contentMode}`);
    } else if (looksLikeFiction) {
      console.log(`[process-note] Fiction cues detected in note ${noteId} but content_mode=${contentMode}; proceeding with normal person suggestions.`);
    }

    // Person detection: check if mentioned people exist as contacts (alias-aware)
    if (people.length > 0 && !skipPersonSuggestions) {
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

      // Build a set of names that are already known as Lexicon (wiki) concepts —
      // these are non-person entities (projects, products, tools, …) and must
      // never trigger an "Add to People" suggestion.
      const lexiconNames = new Set<string>();
      const { data: lexiconPages } = await supabase
        .from("wiki_pages")
        .select("title, slug, aliases")
        .eq("user_id", userId);
      for (const p of (lexiconPages || []) as any[]) {
        if (p.title) lexiconNames.add(String(p.title).toLowerCase());
        if (p.slug) lexiconNames.add(String(p.slug).toLowerCase().replace(/-/g, " "));
        if (Array.isArray(p.aliases)) {
          for (const a of p.aliases) if (a) lexiconNames.add(String(a).toLowerCase());
        }
      }
      // Same-note race: include pages created by wiki-ingest for THIS note.
      const { data: thisNotePages } = await supabase
        .from("wiki_page_sources")
        .select("wiki_pages(title, aliases, slug)")
        .eq("user_id", userId)
        .eq("note_id", noteId);
      for (const row of (thisNotePages || []) as any[]) {
        const wp = row.wiki_pages;
        if (!wp) continue;
        if (wp.title) lexiconNames.add(String(wp.title).toLowerCase());
        if (wp.slug) lexiconNames.add(String(wp.slug).toLowerCase().replace(/-/g, " "));
        if (Array.isArray(wp.aliases)) {
          for (const a of wp.aliases) if (a) lexiconNames.add(String(a).toLowerCase());
        }
      }

      const fullText = `${noteTitle}\n${noteContent}`;
      const { factor: sourceFactor, sourceTag } = getSourceConfidenceFactor(metadata);
      const blocklist = new Set(preferences.personBlocklist || []);

      const newContactCandidates: ReviewSuggestion[] = [];

      for (const person of people) {
        // 1. Exact match
        if (nameToContact.has(person.toLowerCase())) continue;

        // 1b. Already a Lexicon concept (project/product/tool/etc.) — never suggest as a person.
        if (lexiconNames.has(person.toLowerCase())) {
          console.log(`Skipping "${person}" — already a Lexicon entry (non-person)`);
          continue;
        }

        // 2. User-defined / generic blocklist — drop completely.
        if (blocklist.has(person.toLowerCase())) {
          console.log(`Skipping blocklisted name "${person}"`);
          continue;
        }

        // 2b. Per-name fiction guard (layer 1 — deterministic). Blocks iconic
        // characters and names framed as roles/characters in nearby text, even
        // when the note as a whole isn't tagged as fiction.
        const fictionReason = detectFictionalMention(person, fullText);
        if (fictionReason) {
          console.log(`Skipping fictional-looking name "${person}" — ${fictionReason}`);
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

        newContactCandidates.push({
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

      // Layer 2 — LLM verification for new-person candidates. Drops any name
      // the classifier flags as fictional/unclear. Runs at most one small
      // batched call per note, only when there is at least one candidate.
      if (newContactCandidates.length > 0) {
        const names = newContactCandidates.map((s) => String(s.extracted_value || ""));
        const verifiedReal = await verifyRealPeopleWithLLM(userId, noteTitle, fullText, names);
        for (const cand of newContactCandidates) {
          const key = String(cand.extracted_value || "").toLowerCase();
          if (verifiedReal.has(key)) {
            suggestions.push(cand);
          } else {
            console.log(`Fiction guard (LLM) dropped candidate contact "${cand.extracted_value}" from note ${noteId}`);
          }
        }
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
  const selfEntry = matchedPeople.find((p) => p.is_self);
  matchedPeople = matchedPeople.filter((p) => (p.contact_id || p.is_self) && p.canonical_name);
  // Run extraction if we have any matched contact OR a self entry (so OWNER profile facts work too).
  if (matchedPeople.length === 0) return;

  // Skip extraction only for note types that are structurally never biographical
  // (prompt libraries, code snippets, generic docs). Web clips / GitHub / etc.
  // still run but with capped confidence (SOFT_SIGNAL_SOURCES) so facts require
  // user review under conservative sensitivity.
  const sourceApp = (context?.source_app || "").toLowerCase();
  const metaType = String((context?.metadata as any)?.type || "").toLowerCase();
  const nonBiographicalType = ["prompt", "template", "code", "snippet"].includes(metaType);
  if (nonBiographicalType) {
    console.log(`[profile-extract] skipping note ${noteId}: type=${metaType} not biographical`);
    return;
  }
  const isSoftSignal = SOFT_SIGNAL_SOURCES.has(sourceApp);

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
    const selfLine = selfEntry?.canonical_name
      ? `\nNote author (refer to as "me" / "myself" in relationships): ${selfEntry.canonical_name}`
      : "";
    const userPrompt = `People mentioned: ${peopleList}${selfLine}${noteDateLine}\n\nNote title: ${noteTitle}\nNote content:\n${cleanContent}`;

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
      const result = await runChat({
        db: supabase,
        userId,
        callSite: "process-note.profile_extraction",
        messages: [{ role: "user", content: userPrompt }],
        defaults: {
          provider: "openrouter",
          model: "deepseek/deepseek-v4-flash",
          systemPrompt: PROFILE_EXTRACTION_PROMPT,
        },
        callOptions: { response_format: { type: "json_object" } },
      });

      const rawContent = result.content;
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

    if (extractedFacts.length === 0 && extractedRelationships.length === 0) {
      console.log(`No profile facts or relationships extracted from note ${noteId}`);
      return;
    }

    // Map names → { contact_id (null for owner), canonical_name }
    const OWNER_KEY = "__owner__";
    type Target = { contact_id: string | null; canonical_name: string; is_self: boolean };
    const nameToTarget = new Map<string, Target>();
    let ownerTarget: Target | null = null;
    for (const p of matchedPeople) {
      const target: Target = {
        contact_id: p.contact_id || null,
        canonical_name: p.canonical_name || p.name,
        is_self: !!p.is_self,
      };
      nameToTarget.set((p.canonical_name || p.name).toLowerCase(), target);
      nameToTarget.set(p.name.toLowerCase(), target);
      if (p.is_self) {
        ownerTarget = target;
        nameToTarget.set("me", target);
        nameToTarget.set("myself", target);
        nameToTarget.set("i", target);
        nameToTarget.set("the owner", target);
      }
    }
    // Also resolve owner via self aliases
    if (selfEntry) {
      const selfCtxLazy = await loadSelfContext(userId);
      for (const a of selfCtxLazy.aliases) nameToTarget.set(a.toLowerCase(), ownerTarget!);
    }

    const keyFor = (t: Target) => t.contact_id || OWNER_KEY;

    const validFacts: Array<{ contact_name: string; category_slug: string; label: string; value: string; _target: Target }> = [];
    for (const f of extractedFacts) {
      if (!f.contact_name || !f.category_slug || !f.label || !f.value) continue;
      if (!PROFILE_CATEGORY_SLUGS.includes(f.category_slug)) {
        console.log(`[profile-extract] Dropping fact: invalid category_slug="${f.category_slug}"`);
        continue;
      }
      // Phase A canonicalization (source-side only, non-destructive):
      // 1) Re-home well-known cross-category labels (e.g. Place of birth → identity).
      // 2) Canonicalize the label within the (possibly corrected) category.
      const correctedSlug = correctProfileCategory(f.label, f.category_slug);
      if (PROFILE_CATEGORY_SLUGS.includes(correctedSlug)) {
        f.category_slug = correctedSlug;
      }
      f.label = canonicalProfileLabel(f.category_slug, f.label);

      const nm = f.contact_name.toLowerCase().trim();
      let target = nameToTarget.get(nm) || null;
      if (!target) {
        for (const [key, t] of nameToTarget) {
          if (isFuzzyMatch(f.contact_name, key)) { target = t; break; }
        }
      }
      if (!target) {
        console.log(`[profile-extract] Dropping fact: unmatched contact_name="${f.contact_name}"`);
        continue;
      }
      f.contact_name = target.canonical_name;
      validFacts.push({ ...f, _target: target });
    }

    console.log(`[profile-extract] ${extractedFacts.length} parsed → ${validFacts.length} valid for note ${noteId}`);

    if (validFacts.length === 0 && extractedRelationships.length === 0) {
      return;
    }

    // Look up existing profile entries (per contact, plus owner with contact_id IS NULL)
    const contactIds = [...new Set(validFacts.map((f) => f._target.contact_id).filter(Boolean))] as string[];
    const hasOwnerFact = validFacts.some((f) => !f._target.contact_id);

    const existingEntries: any[] = [];
    const existingCategories: any[] = [];
    if (contactIds.length > 0) {
      const { data: e1 } = await supabase
        .from("profile_entries")
        .select("contact_id, label, value, category_id")
        .eq("user_id", userId)
        .in("contact_id", contactIds);
      existingEntries.push(...(e1 || []));
      const { data: c1 } = await supabase
        .from("profile_categories")
        .select("id, slug, contact_id")
        .eq("user_id", userId)
        .in("contact_id", contactIds);
      existingCategories.push(...(c1 || []));
    }
    if (hasOwnerFact) {
      const { data: e2 } = await supabase
        .from("profile_entries")
        .select("contact_id, label, value, category_id")
        .eq("user_id", userId)
        .is("contact_id", null);
      existingEntries.push(...(e2 || []));
      const { data: c2 } = await supabase
        .from("profile_categories")
        .select("id, slug, contact_id")
        .eq("user_id", userId)
        .is("contact_id", null);
      existingCategories.push(...(c2 || []));
    }

    // Existing review_queue items — count toward dedup so we don't
    // regenerate a suggestion already waiting in the queue.
    const { data: existingQueueItems } = await supabase
      .from("review_queue")
      .select("payload, status")
      .eq("user_id", userId)
      .eq("suggestion_type", "add_profile_entry")
      .in("status", ["pending", "pending_review", "auto_applied_unreviewed", "kept", "blocked", "accepted", "dismissed"]);

    // Token-aware dedup index. For list-valued canonical labels
    // (Health conditions, Favorite food, Allergies, Nickname, …) it stores
    // per-token keys per (contact, canonical-label-group), so reshuffled
    // list values ("MDD, BPD" vs "MDD, BPD, panic attacks") no longer look
    // like brand-new facts. Non-list labels fall back to the original
    // exact-normalized-value + singleton behavior.
    const dedupIndex = buildProfileTokenIndex(
      existingEntries as any[],
      (existingQueueItems || []).map((q: any) => ({
        contact_id: q.payload?.contact_id ?? null,
        label: String(q.payload?.label || ""),
        value: String(q.payload?.value || ""),
      })),
    );

    const suggestions: ReviewSuggestion[] = [];
    const perTargetCount = new Map<string, number>();

    for (const fact of validFacts) {
      const target = fact._target;
      const tKey = keyFor(target);
      const dd = dedupIncomingProfileValue({
        contactId: target.contact_id,
        label: fact.label,
        value: fact.value,
        index: dedupIndex,
      });
      if (dd.action === "skip") {
        console.log(`[profile-extract] dedup skip (${dd.reason}) "${fact.label}: ${fact.value}" for ${target.canonical_name}`);
        continue;
      }
      // Use the (possibly narrowed) value returned by the guard — for a
      // list label with partial overlap this drops the tokens already known.
      const effectiveValue = dd.value;

      const count = perTargetCount.get(tKey) || 0;
      if (count >= MAX_FACTS_PER_CONTACT_PER_NOTE) continue;
      perTargetCount.set(tKey, count + 1);

      const catRow = existingCategories.find(
        (c: any) => c.slug === fact.category_slug && (c.contact_id || null) === target.contact_id,
      );

      const ownerLabelName = target.is_self ? "your" : `${target.canonical_name}'s`;

      suggestions.push({
        user_id: userId,
        source_note_id: noteId,
        suggestion_type: "add_profile_entry",
        title: `Add to ${ownerLabelName} profile: ${fact.label}`,
        description: `"${effectiveValue}" — extracted from "${noteTitle}"`,
        payload: {
          contact_id: target.contact_id,
          contact_name: target.canonical_name,
          is_owner: target.contact_id === null,
          category_slug: fact.category_slug,
          category_id: catRow?.id || null,
          label: fact.label,
          value: effectiveValue,
        },
        status: "pending_review",
        target_entity_type: "profile_entry",
        source_title: noteTitle,
        extracted_value: `${fact.label}: ${effectiveValue}`,
        confidence_score: isSoftSignal
          ? Math.min(SOFT_SIGNAL_CONFIDENCE_CAP, DEFAULT_CONFIDENCE.add_profile_entry)
          : DEFAULT_CONFIDENCE.add_profile_entry,
        is_sensitive: isSensitiveSuggestion("add_profile_entry", { ...(fact as unknown as Record<string, unknown>), value: effectiveValue }, noteContent),
        suppression_key: buildSuppressionKey("add_profile_entry", target.contact_id ? "contact" : "owner", target.contact_id, `${fact.label}:${effectiveValue}`),
      });
    }


    if (suggestions.length > 0) {
      const unsuppressed = await filterSuppressedSuggestions(userId, suggestions);
      const prepared = await Promise.all(unsuppressed.map((s) => prepareSuggestionForInsert(s, preferences)));
      const { error } = await supabase.from("review_queue").insert(prepared);
      if (error) console.error("Profile suggestion insert error:", error);
      else console.log(`Created ${prepared.length} profile suggestions for note ${noteId}`);
    } else {
      console.log(`All profile facts already known for note ${noteId}`);
    }


    // ── Relationship suggestions ──
    if (extractedRelationships.length > 0) {
      const relSuggestions: typeof suggestions = [];

      // Load existing relationships AND queue items so we can dedupe by
      // canonical pair key (direction-independent for symmetric labels).
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

      const seenKeys = new Set<string>();
      for (const r of existingRels || []) {
        const a: EntityRef = { type: (r as any).source_type, id: (r as any).source_id };
        const b: EntityRef = { type: (r as any).target_type, id: (r as any).target_id };
        seenKeys.add(relationshipPairKey(userId, a, b, (r as any).label));
      }
      for (const q of existingRelQueue || []) {
        const p = (q as any).payload || {};
        if (!p.source_type || !p.target_type || !p.label) continue;
        const a: EntityRef = { type: p.source_type, id: p.source_id || null };
        const b: EntityRef = { type: p.target_type, id: p.target_id || null };
        seenKeys.add(relationshipPairKey(userId, a, b, p.label));
      }

      const selfCtxRel = await loadSelfContext(userId);
      for (const rel of extractedRelationships) {
        const isSelfA = /^(me|myself|i|my|mine)$/i.test(rel.person_a) || (selfCtxRel.enabled && nameMatchesAlias(rel.person_a, selfCtxRel.aliases));
        const isSelfB = /^(me|myself|i|my|mine)$/i.test(rel.person_b) || (selfCtxRel.enabled && nameMatchesAlias(rel.person_b, selfCtxRel.aliases));

        let contactA: { id: string; name: string } | null = null;
        let contactB: { id: string; name: string } | null = null;

        if (!isSelfA) {
          const matchA = nameToTarget.get(rel.person_a.toLowerCase());
          if (matchA && matchA.contact_id) contactA = { id: matchA.contact_id, name: matchA.canonical_name };
          else {
            for (const [key, c] of nameToTarget) {
              if (c.contact_id && isFuzzyMatch(rel.person_a, key)) {
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
          const matchB = nameToTarget.get(rel.person_b.toLowerCase());
          if (matchB && matchB.contact_id) contactB = { id: matchB.contact_id, name: matchB.canonical_name };
          else {
            for (const [key, c] of nameToTarget) {
              if (c.contact_id && isFuzzyMatch(rel.person_b, key)) {
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

        if (isSelfA && isSelfB) continue;

        const canonical = canonicalLabel(rel.label_a_to_b);
        const inverse = canonicalLabel(rel.label_b_to_a) || inverseLabel(canonical);
        if (!canonical) continue;

        const aRef: EntityRef = { type: isSelfA ? "self" : "contact", id: isSelfA ? null : contactA!.id };
        const bRef: EntityRef = { type: isSelfB ? "self" : "contact", id: isSelfB ? null : contactB!.id };
        const pairKey = relationshipPairKey(userId, aRef, bRef, canonical);
        if (seenKeys.has(pairKey)) continue;
        seenKeys.add(pairKey);

        const nameA = isSelfA ? "Me" : contactA!.name;
        const nameB = isSelfB ? "Me" : contactB!.name;
        const title = `Add relationship: ${nameA} → ${nameB} (${canonical})`;

        relSuggestions.push({
          user_id: userId,
          source_note_id: noteId,
          suggestion_type: "add_relationship",
          title,
          description: `${nameA} is ${canonical} of ${nameB}`,
          payload: {
            source_type: aRef.type,
            source_id: aRef.id,
            target_type: bRef.type,
            target_id: bRef.id,
            label: canonical,
            // Only suggest a mirror for asymmetric labels
            inverse_label: isSymmetricLabel(canonical) ? null : inverse,
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
          extracted_value: `${nameA} ${canonical} ${nameB}`,
          confidence_score: DEFAULT_CONFIDENCE.add_relationship,
          is_sensitive: isSensitiveSuggestion("add_relationship", { ...rel, nameA, nameB }, noteContent),
          suppression_key: buildSuppressionKey("add_relationship", "relationship", null, pairKey),
        });
      }

      if (relSuggestions.length > 0) {
        const unsuppressed = await filterSuppressedSuggestions(userId, relSuggestions);
        const preparedRels = await Promise.all(
          unsuppressed.map((s) => prepareSuggestionForInsert(s, preferences)),
        );
        const { error } = await supabase.from("review_queue").insert(preparedRels);
        if (error) console.error("Relationship suggestion insert error:", error);
        else console.log(`Created ${preparedRels.length} relationship suggestions for note ${noteId}`);
      }
    }

    // ── Phase B: incremental profile normalization ──
    // After writing new add_profile_entry suggestions for this note, normalize
    // each touched subject's now-current SAVED profile. Best-effort: never
    // throw out of process-note.
    try {
      const touchedContactIds = new Set<string>();
      let touchedOwner = false;
      for (const f of validFacts) {
        if (f._target.contact_id) touchedContactIds.add(f._target.contact_id);
        else touchedOwner = true;
      }
      const subjects: Array<string | null> = [];
      if (touchedOwner) subjects.push(null);
      for (const cid of touchedContactIds) subjects.push(cid);

      for (const subj of subjects) {
        try {
          const res = await createNormalizationSuggestions({
            supabase,
            userId,
            contactId: subj,
            preferences,
            sourceNoteId: noteId,
            helpers: {
              filterSuppressedSuggestions,
              prepareSuggestionForInsert,
              isSensitiveSuggestion,
              buildSuppressionKey,
            },
          });
          if (res.created > 0) {
            console.log(`[normalize-profile] subject=${subj ?? "owner"} created=${res.created} auto=${res.autoApplied}`);
          }
        } catch (e) {
          console.error(`[normalize-profile] subject=${subj ?? "owner"} failed:`, e);
        }
      }
    } catch (e) {
      console.error("[normalize-profile] incremental pass failed:", e);
    }
  } catch (err) {
    console.error("generateProfileSuggestions error:", err);
  }
}

/* ── Moment (timeline event) suggestion generator ──
 * Detects concrete PAST events in the note (with attached document OCR) and
 * proposes adding them to the timeline. Honors auto-apply prefs via
 * prepareSuggestionForInsert and dedups against existing moments. */
const MOMENT_EXTRACTION_PROMPT = `You inspect a personal note (which may include OCR text from attached scanned documents) and decide whether it documents a single concrete PAST real-world event that belongs on the user's personal timeline (e.g. wedding, graduation, birth, move, job change, trip, hospitalisation, milestone meeting, funeral, anniversary celebration).

Return JSON:
{
  "is_event": boolean,
  "happened_at": "YYYY-MM-DD" | null,
  "title": short explicit title (e.g. "Wedding of Michael and Xihui"),
  "description": one-sentence description,
  "impact_level": integer 1-4 (1=minor, 4=major life event),
  "confidence_date": integer 0-10,
  "confidence_truth": integer 0-10,
  "participants": [ { "name": string, "is_self": boolean } ]
}

Rules:
- is_event = true ONLY when a clearly identifiable past event with a specific date is described or documented. Diaries, opinions, prompts, code, articles, recurring routines → false.
- happened_at MUST be an ISO date present in the note (or computable from the OCR).
- title should describe the event explicitly (not the note's title verbatim).
- participants lists the real humans involved, marking the OWNER with is_self:true.
- If unsure, return is_event:false.`;

async function generateMomentSuggestions(
  userId: string,
  noteId: string,
  noteTitle: string,
  fullText: string,
  matchedPeople: Array<{ name: string; contact_id?: string; canonical_name?: string; is_self?: boolean }>,
  metadata: Record<string, unknown>,
) {
  try {
    const dates = Array.isArray((metadata as any).dates_mentioned) ? ((metadata as any).dates_mentioned as string[]) : [];
    const hasContactOrSelf = matchedPeople.some((p) => p.contact_id || p.is_self);
    if (dates.length === 0 || !hasContactOrSelf) return;

    const preferences = await getSuggestionPreferences(userId);
    if (preferences.mode === "off") return;

    const balance = await checkBalance(supabase, userId);
    if (!balance.allowed) return;

    const peopleHint = matchedPeople
      .map((p) => `${p.canonical_name || p.name}${p.is_self ? " (owner)" : ""}`)
      .join(", ");
    const datesHint = dates.join(", ");
    const userPrompt = `Known people in this note: ${peopleHint}\nDates mentioned: ${datesHint}\n\nNote title: ${noteTitle}\nNote content (including [Media content] OCR):\n${stripHtmlIfNeeded(fullText).slice(0, 16000)}`;

    let parsed: any;
    try {
      const result = await runChat({
        db: supabase,
        userId,
        callSite: "process-note.moment_extraction",
        messages: [{ role: "user", content: userPrompt }],
        defaults: {
          provider: "openrouter",
          model: "deepseek/deepseek-v4-flash",
          systemPrompt: MOMENT_EXTRACTION_PROMPT,
        },
        callOptions: { response_format: { type: "json_object" } },
      });
      parsed = JSON.parse(result.content);
    } catch (err: any) {
      if (err?.message === "INSUFFICIENT_CREDITS") return;
      console.error("[moment-extract] LLM error:", err);
      return;
    }

    if (!parsed || parsed.is_event !== true) {
      console.log(`[moment-extract] not an event for note ${noteId}`);
      return;
    }
    const happenedAt = String(parsed.happened_at || "").trim();
    const title = String(parsed.title || "").trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(happenedAt) || !title) return;

    const description = String(parsed.description || "").trim() || null;
    const impact = Math.max(1, Math.min(4, Number(parsed.impact_level) || 2));
    const confDate = Math.max(0, Math.min(10, Number(parsed.confidence_date) || 7));
    const confTruth = Math.max(0, Math.min(10, Number(parsed.confidence_truth) || 7));

    // Map LLM participants → matched contacts / self
    type ParticipantPayload = { name: string; contact_id: string | null; is_self: boolean };
    const participants: ParticipantPayload[] = [];
    const seenIds = new Set<string>();
    const seenSelf = { v: false };
    const llmParticipants: Array<{ name?: string; is_self?: boolean }> = Array.isArray(parsed.participants) ? parsed.participants : [];
    for (const lp of llmParticipants) {
      const nm = String(lp?.name || "").trim();
      const isSelf = !!lp?.is_self;
      const matched = matchedPeople.find((p) => {
        if (isSelf && p.is_self) return true;
        if (!nm) return false;
        const key = (p.canonical_name || p.name).toLowerCase();
        return key === nm.toLowerCase() || isFuzzyMatch(nm, key);
      });
      if (!matched) continue;
      if (matched.is_self) {
        if (seenSelf.v) continue;
        seenSelf.v = true;
        participants.push({ name: matched.canonical_name || "Me", contact_id: null, is_self: true });
      } else if (matched.contact_id) {
        if (seenIds.has(matched.contact_id)) continue;
        seenIds.add(matched.contact_id);
        participants.push({ name: matched.canonical_name || matched.name, contact_id: matched.contact_id, is_self: false });
      }
    }
    // Fallback: include all matched people if LLM gave no usable participants
    if (participants.length === 0) {
      for (const p of matchedPeople) {
        if (p.is_self && !seenSelf.v) {
          seenSelf.v = true;
          participants.push({ name: p.canonical_name || "Me", contact_id: null, is_self: true });
        } else if (p.contact_id && !seenIds.has(p.contact_id)) {
          seenIds.add(p.contact_id);
          participants.push({ name: p.canonical_name || p.name, contact_id: p.contact_id, is_self: false });
        }
      }
    }
    if (participants.length === 0) return;

    // Dedup against existing moments: same date ±2 days + overlapping title token + at least one shared participant
    const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
    const candidateTokens = new Set(normalize(title).split(" ").filter((t) => t.length > 3));
    const dateMin = new Date(new Date(happenedAt).getTime() - 2 * 86400000).toISOString();
    const dateMax = new Date(new Date(happenedAt).getTime() + 2 * 86400000).toISOString();
    const { data: nearby } = await supabase
      .from("moments")
      .select("id, title, happened_at, person_id")
      .eq("user_id", userId)
      .gte("happened_at", dateMin)
      .lte("happened_at", dateMax)
      .is("deleted_at", null);
    const contactPersonIds = new Set(participants.filter((p) => p.contact_id).map((p) => p.contact_id!));
    for (const m of (nearby || []) as any[]) {
      const existingTokens = new Set(normalize(String(m.title || "")).split(" ").filter((t) => t.length > 3));
      let overlap = 0;
      for (const t of candidateTokens) if (existingTokens.has(t)) overlap++;
      if (overlap === 0) continue;
      // If date matches exactly OR any shared participant, treat as duplicate
      const sameDate = String(m.happened_at).slice(0, 10) === happenedAt;
      const sharedPerson = m.person_id && contactPersonIds.has(m.person_id);
      if (sameDate || sharedPerson) {
        console.log(`[moment-extract] duplicate of existing moment ${m.id}, skipping`);
        return;
      }
    }

    const suppressionKey = buildSuppressionKey("add_moment", "moment", null, `${normalize(title)}|${happenedAt}`);

    // Dedup against existing review_queue entries
    const { data: existingQ } = await supabase
      .from("review_queue")
      .select("id")
      .eq("user_id", userId)
      .eq("suggestion_type", "add_moment")
      .eq("suppression_key", suppressionKey)
      .limit(1);
    if (existingQ && existingQ.length > 0) {
      console.log(`[moment-extract] review_queue already has this moment suggestion`);
      return;
    }

    const suggestion: ReviewSuggestion = {
      user_id: userId,
      source_note_id: noteId,
      suggestion_type: "add_moment",
      title: `Add timeline moment: ${title}`,
      description: `${happenedAt}${description ? " — " + description : ""}`,
      payload: {
        title,
        description,
        happened_at: happenedAt,
        impact_level: impact,
        confidence_date: confDate,
        confidence_truth: confTruth,
        participants,
      },
      status: "pending_review",
      target_entity_type: "moment",
      source_title: noteTitle,
      extracted_value: `${title} (${happenedAt})`,
      // Derive score from LLM-reported date+truth certainty (0-10 each).
      // Mapping: avg=10 → 0.95, avg=9 → 0.90, avg=8 → 0.86 (clears 0.85 conservative bar),
      // avg=7 → 0.80, avg=6 → 0.74, avg=5 → 0.68, avg≤3 → ≤0.55.
      // Floor 0.50, ceiling 0.95. Genuinely uncertain moments stay in review.
      confidence_score: Math.max(0.5, Math.min(0.95, 0.5 + ((confDate + confTruth) / 20) * 0.45)),
      is_sensitive: isSensitiveSuggestion("add_moment", { title, description: description || "" }, fullText),
      suppression_key: suppressionKey,
    };

    const unsuppressed = await filterSuppressedSuggestions(userId, [suggestion]);
    if (unsuppressed.length === 0) return;
    const prepared = await Promise.all(unsuppressed.map((s) => prepareSuggestionForInsert(s, preferences)));
    const { error } = await supabase.from("review_queue").insert(prepared);
    if (error) console.error("Moment suggestion insert error:", error);
    else console.log(`Created moment suggestion for note ${noteId} (status=${prepared[0]?.status})`);
  } catch (err) {
    console.error("generateMomentSuggestions error:", err);
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
      const chatResult = await runChat({
        db: supabase,
        userId: note.user_id,
        callSite: "process-note.metadata",
        messages: [{ role: "user", content: fullText.slice(0, 24000) }],
        defaults: {
          provider: "openrouter",
          model: "deepseek/deepseek-v4-flash",
          systemPrompt: METADATA_SYSTEM_PROMPT,
        },
        callOptions: { response_format: { type: "json_object" } },
      });

      try {
        metadata = JSON.parse(chatResult.content);
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
      // Build contact map for action items
      for (const [name, contact] of nameToContact) {
        contactMap[name] = contact.id;
      }
    }

    // Deterministic name scan: always run, even when metadata.people was empty
    // or when the metadata LLM missed a person. This catches notes like
    // "Marriage Papers Xihui and Michael" where the metadata pass produced no
    // `people` field, and ensures wikilinks/exact-name occurrences are picked
    // up regardless of LLM choices.
    try {
      const { data: allContactsScan } = await supabase
        .from("contacts")
        .select("id, name, aliases")
        .eq("user_id", note.user_id)
        .is("merged_into", null);

      const alreadyMatchedIds = new Set(matchedPeople.filter((p) => p.contact_id).map((p) => p.contact_id!));
      const noteLower = noteFullText.toLowerCase();
      const wikilinkSlugs = new Set<string>();
      for (const m of noteFullText.matchAll(/\[\[([^\]|]+?)(?:\|[^\]]+)?\]\]/g)) {
        const slug = (m[1] || "").trim().toLowerCase();
        if (slug) wikilinkSlugs.add(slug);
      }

      for (const c of (allContactsScan || []) as any[]) {
        if (alreadyMatchedIds.has(c.id)) continue;
        const names: string[] = [c.name, ...((c.aliases as string[] | null) || [])].filter(Boolean);
        let hit: string | null = null;
        for (const n of names) {
          const nLower = n.toLowerCase();
          if (wikilinkSlugs.has(nLower)) { hit = n; break; }
          // Word-boundary match against full text for full names and aliases
          const escaped = nLower.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
          const re = new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`, "i");
          if (re.test(noteLower)) { hit = n; break; }
        }
        if (hit) {
          matchedPeople.push({ name: hit, contact_id: c.id, canonical_name: c.name });
          alreadyMatchedIds.add(c.id);
        }
      }

      // Self-inclusion: detect first-person language or user's own name/aliases.
      const hasSelf = matchedPeople.some((p) => p.is_self);
      if (!hasSelf && selfCtx.enabled) {
        const firstPersonRe = /\b(i|i'm|i've|i'll|my|mine|me|myself|mein|meine|meinem|meinen|meiner|ich|mir|mich)\b/i;
        let selfHit = firstPersonRe.test(noteFullText);
        if (!selfHit) {
          for (const alias of selfCtx.aliases) {
            const escaped = alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
            const re = new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`, "i");
            if (re.test(noteLower)) { selfHit = true; break; }
          }
        }
        if (selfHit) {
          matchedPeople.push({ name: selfCtx.preferredName || "me", is_self: true, canonical_name: selfCtx.preferredName || "Me" });
        }
      }

      if (matchedPeople.length > 0) {
        metadata.matched_people = matchedPeople;
      }
    } catch (scanErr) {
      console.error("[process-note] deterministic name scan error:", scanErr);
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

    // Generate profile suggestions for matched people + OWNER (one extra LLM call).
    // Pass fullText (includes [Media content] OCR) so scans/IDs contribute facts.
    await generateProfileSuggestions(note.user_id, noteId, note.title, fullText, matchedPeople, {
      source_app: (note as any).source_app,
      is_external: (note as any).is_external,
      metadata: mergedMetadata,
      note_created_at: (note as any).created_at ?? null,
    });

    // Generate timeline-moment suggestions from past events documented in the note.
    await generateMomentSuggestions(note.user_id, noteId, note.title, fullText, matchedPeople, mergedMetadata);

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

    console.log("process-note completed for:", noteId);
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

    // Authorize the caller. This function runs with the service-role key and
    // derives user_id from the note row, so an unauthenticated caller could
    // otherwise force AI reprocessing of ANY note (draining the owner's credits
    // and the shared LLM budget) just by guessing a note UUID. Accept either:
    //   (a) an internal service-role call (other edge functions fan out here), or
    //   (b) a real user JWT whose user owns the target note.
    const token = authHeader.replace("Bearer ", "").trim();
    const isInternal = token === Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!isInternal) {
      const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
      if (authErr || !user) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const { data: owned } = await supabase
        .from("notes")
        .select("user_id")
        .eq("id", note_id)
        .single();
      if (!owned || owned.user_id !== user.id) {
        return new Response(JSON.stringify({ error: "Forbidden" }), {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
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
