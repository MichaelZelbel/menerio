import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  checkBalance,
  insufficientCreditsResponse,
} from "../_shared/llm-credits.ts";
import { outputLanguageRule, parseModelJson, runChat, sourceLanguageRule } from "../_shared/llm-router.ts";
import {
  PROCESS_NOTE_METADATA_PROMPT,
  PROCESS_NOTE_MOMENT_PROMPT,
  PROCESS_NOTE_PROFILE_PROMPT,
  metadataFieldContract,
  profileExtractionContract,
} from "../_shared/llm-defaults.ts";
import { embedAndStoreNoteChunks } from "../_shared/chunk-embeddings.ts";
import { shouldExtractFacts } from "../_shared/hub-source.ts";
import { findOrCreateContact } from "../_shared/find-or-create-contact.ts";
import {
  canonicalLabel,
  inverseLabel,
  isSymmetricLabel,
  relationshipPairKey,
  type EntityRef,
} from "../_shared/relationship-canonical.ts";
import {
  PROFILE_CANONICAL_SCHEMA,
  PROFILE_CATEGORY_SLUGS,
  blockedLabelAsRelationship,
  canonicalProfileLabel,
  correctProfileCategory,
  isKnownCanonicalLabel,
  isBlockedProfileLabel,
  normalizeProfileValueForDedup,
} from "../_shared/profile-canonical-schema.ts";
import {
  loadProfileFields,
  ProfileFieldsRegistry,
} from "../_shared/profile-fields-registry.ts";
import { isSkillLabel, routeSkillValue } from "../_shared/profile-skill-guard.ts";
import { guardNameValue, isNameLabel } from "../_shared/profile-name-guard.ts";
import { gateStoredValue } from "../_shared/profile-fact-gate.ts";

import {
  applyNormalization,
  createNormalizationSuggestions,
} from "../_shared/profile-normalization.ts";
import {
  buildProfileTokenIndex,
  dedupIncomingProfileValue,
} from "../_shared/profile-dedup.ts";
import { profileValueDecision, relationshipWriteDecision } from "../_shared/profile-integrity.ts";
import {
  RELATIONSHIP_ADJUDICATION_VERSION,
  adjudicateRelationship,
  exactQuoteExists,
  noteContentHash,
} from "../_shared/relationship-adjudicator.ts";

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
      let found: { id: string; created: boolean };
      try {
        found = await findOrCreateContact(supabase, suggestion.user_id, name);
      } catch {
        return { ...suggestion, status: "pending_review" };
      }
      return { ...suggestion, status: "auto_applied_unreviewed", target_entity_id: found.id, applied_at: new Date().toISOString() };
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

      const factDecision = profileValueDecision(categorySlug, label, value);
      if (!factDecision.ok) return { ...suggestion, status: "removed" };
      const { data, error } = await supabase
        .from("profile_entries")
        .insert({ user_id: suggestion.user_id, contact_id: contactId, category_id: categoryId, label: factDecision.label, value: factDecision.value, sort_order: 0, origin: "ai_note", evidence_quote: String((suggestion.payload as any)?.evidence_quote || "").trim(), linked_note_id: (suggestion as any).source_note_id || null })
        .select("id")
        .single();
      if (error && (error as any).code === "23505") return { ...suggestion, status: "removed" };
      if (error || !data) return { ...suggestion, status: "pending_review" };
      return { ...suggestion, status: "auto_applied_unreviewed", target_entity_id: data.id, applied_at: new Date().toISOString() };
    }

    if (suggestion.suggestion_type === "add_relationship") {
      const { source_type, source_id, target_type, target_id, label, custom_label } = suggestion.payload as Record<string, string | null>;
      if (!source_type || !target_type || !label) return { ...suggestion, status: "pending_review" };
      const relationshipDecision = relationshipWriteDecision({
        userId: suggestion.user_id,
        sourceType: source_type as "contact" | "self",
        sourceId: source_id || null,
        targetType: target_type as "contact" | "self",
        targetId: target_id || null,
        label,
      });
      if (relationshipDecision.ok === false) return { ...suggestion, status: "removed" };
      // Hard evidence gate: an automated relationship without a verbatim quote
      // from a note is never written — it waits for human review instead.
      const relEvidenceQuote = String((suggestion.payload as any)?.evidence_quote || "").trim();
      if (relEvidenceQuote.length < 10) return { ...suggestion, status: "pending_review" };
      const { data, error } = await supabase
        .from("contact_relationships")
        .insert({ user_id: suggestion.user_id, source_type, source_id: source_id || null, target_type, target_id: target_id || null, label: relationshipDecision.label, custom_label: custom_label || null, origin: "ai_note", evidence_quote: relEvidenceQuote, evidence_note_id: (suggestion.payload as any)?.note_id || (suggestion as any).source_note_id || null })
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

// The metadata prompt and the profile prompt now live in `_shared/llm-defaults.ts`
// as PROCESS_NOTE_METADATA_PROMPT and PROCESS_NOTE_PROFILE_PROMPT, with the
// fields the code reads restated in metadataFieldContract() and
// profileExtractionContract() and appended via systemSuffix. Both used to have a
// second copy here, and a registered call site with a second copy in the edge
// function is exactly how each of them ended up running a prompt nobody had read
// in months. The category slugs come from the canonical schema for the same
// reason: one list, no hand-typed duplicate.

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

/**
 * Guard against the classic profile failure: one situational remark
 * ("she feels insecure about her weight") becoming a permanent, global
 * personality trait ("insecure").
 *
 * Deterministic: a trait value is rejected when it is a BARE adjective
 * (no qualifier of its own) and every mention of that word in the source note
 * is immediately followed by a qualifier ("about X", "when Y", "with Z", ...).
 * Traits that already carry their qualifier are kept as-is.
 */
const TRAIT_QUALIFIERS = /^(?:\s*)(?:about|regarding|with|when|whenever|around|because|due to|over|towards?|in|at|of|bezüglich|wegen|bei|über)\b/i;

export function isOvergeneralizedTrait(value: string, noteContent: string): boolean {
  const v = String(value || "").trim();
  if (!v) return false;
  // Already qualified ("insecure about her weight") → keep.
  const words = v.split(/\s+/);
  if (words.length > 2) return false;
  if (TRAIT_QUALIFIERS.test(" " + words.slice(1).join(" "))) return false;

  const haystack = String(noteContent || "");
  const needle = words[0].toLowerCase();
  if (needle.length < 4) return false;

  let found = 0;
  let qualified = 0;
  const re = new RegExp(`\\b${needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\w*`, "gi");
  for (const m of haystack.matchAll(re)) {
    found++;
    const tail = haystack.slice((m.index ?? 0) + m[0].length, (m.index ?? 0) + m[0].length + 40);
    if (TRAIT_QUALIFIERS.test(tail)) qualified++;
  }
  // No mention at all → the model invented the generalization: reject.
  if (found === 0) return true;
  return qualified === found;
}



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
  facts: Array<{ contact_name: string; category_slug: string; label: string; value: string; source_quote?: string }>,
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
  noteId: string | null,
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
      noteId,
      messages: [{ role: "user", content: userPrompt }],
      defaults: {
        provider: "openrouter",
        model: "deepseek/deepseek-v4-flash",
        systemPrompt: "You classify whether extracted names refer to real people the note's author knows, or to fictional characters. Be strict: when the surrounding text frames the name as a character, role, or media reference, mark it fictional. When context is thin, mark it unclear. Output valid JSON only.",
      },
      callOptions: { response_format: { type: "json_object" } },
    });
    const parsed = parseModelJson<any>(result.content) ?? {};
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
        const verifiedReal = await verifyRealPeopleWithLLM(userId, noteTitle, fullText, names, noteId);
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

    // Load the user's effective profile-field vocabulary so extraction respects
    // fields they have already approved via the review queue.
    const profileFieldsRows = await loadProfileFields(supabase, userId);
    const profileFieldsRegistry = new ProfileFieldsRegistry(profileFieldsRows);

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
      source_quote?: string;
    }> = [];
    let extractedRelationships: Array<{
      person_a: string;
      person_b: string;
      label_a_to_b: string;
      label_b_to_a: string;
      source_quote: string;
      source_context: string;
    }> = [];

    try {
      const result = await runChat({
        db: supabase,
        userId,
        callSite: "process-note.profile_extraction",
        noteId,
        messages: [{ role: "user", content: userPrompt }],
        defaults: {
          provider: "openrouter",
          model: "deepseek/deepseek-v4-flash",
          systemPrompt: PROCESS_NOTE_PROFILE_PROMPT,
        },
        // Everything here is appended AFTER the llm_call_configs row, so it is
        // the only part of the prompt a stale row cannot drop. That matters more
        // than it sounds: this call site HAS a row, seeded 2026-06-01, and it
        // never asked for `source_quote`. The quote gate below then discarded
        // every fact the model found, for eight days, while the log said the
        // facts were already known. The field contract belongs here for good.
        systemSuffix: [
          profileExtractionContract(),
          outputLanguageRule(preferences.profileLanguage),
        ].join("\n\n"),
        callOptions: { response_format: { type: "json_object" } },
      });

      const rawContent = result.content;
      console.log(`[profile-extract] Raw LLM response for note ${noteId}:`, rawContent);
      const parsed = parseModelJson<any>(rawContent);
      if (parsed === null) {
        // Not the same thing as "no facts in this note". Say which it was.
        console.error(
          `[profile-extract] model returned no parseable JSON for note ${noteId} — extraction abandoned. First 200 chars: ${JSON.stringify(String(rawContent ?? "").slice(0, 200))}`,
        );
        return;
      }

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
             source_quote: (r.source_quote || "").trim(),
             source_context: (r.source_context || "").trim(),
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
        source_quote: (f.source_quote || "").trim(),
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

    const validFacts: Array<{ contact_name: string; category_slug: string; label: string; value: string; source_quote?: string; _target: Target }> = [];
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

      // Skill guard: a person's name, a product, a language or a bare topic is
      // not a skill. Route each list member to where it belongs (or drop it)
      // before the fact is ever written.
      if (isSkillLabel(f.label) && !(f as any)._skillChecked) {
        (f as any)._skillChecked = true;
        const routes = routeSkillValue(f.value, {
          personNames: [...nameToTarget.keys()],
          productNames: [],
        });
        const buckets = new Map<string, { label: string; slug: string; members: string[] }>();
        for (const r of routes) {
          if (r.action === "drop") {
            console.log(`[profile-extract] Skill guard dropped "${r.member}" (${r.reason})`);
            continue;
          }
          const label = r.action === "keep" ? "Skill" : r.label;
          const slug = r.action === "keep" ? f.category_slug : r.categorySlug;
          if (r.action === "rehome") {
            console.log(`[profile-extract] Skill guard rehomed "${r.member}" → ${label} (${r.reason})`);
          }
          const k = `${slug}|${label}`;
          if (!buckets.has(k)) buckets.set(k, { label, slug, members: [] });
          buckets.get(k)!.members.push(r.member);
        }
        const groups = [...buckets.values()];
        if (groups.length === 0) continue;
        const [first, ...rest] = groups;
        f.label = first.label;
        f.category_slug = first.slug;
        f.value = first.members.join(", ");
        for (const g of rest) {
          extractedFacts.push({
            ...f,
            label: g.label,
            category_slug: g.slug,
            value: g.members.join(", "),
            _skillChecked: true,
          } as any);
        }
      }

      // Name guard: handles, OCR noise and re-statements of the person's own
      // name must never become "Nickname" entries. Multi-value name fields
      // are decided member by member.
      if (isNameLabel(f.label)) {
        const members = String(f.value)
          .split(/\s*,\s*/)
          .map((m) => m.trim())
          .filter(Boolean);
        const kept: string[] = [];
        const handles: string[] = [];
        for (const member of members) {
          const decision = guardNameValue({ label: f.label, value: member, personName: f.contact_name });
          if (decision.action === "drop") {
            console.log(`[profile-extract] Name guard dropped "${member}" (${decision.reason})`);
            continue;
          }
          if (decision.action === "relabel") {
            console.log(`[profile-extract] Name guard relabelled "${member}" → ${decision.label} (${decision.reason})`);
            handles.push(decision.value);
            continue;
          }
          kept.push(decision.value);
        }
        if (handles.length > 0) {
          extractedFacts.push({
            ...f,
            label: "Online handle",
            category_slug: "communication",
            value: handles.join(", "),
            _skillChecked: true,
          } as any);
        }
        if (kept.length === 0) continue;
        f.value = kept.join(", ");
      }

      // Label gate: in a structured category, a label the schema does not
      // know means the extractor invented a synonym ("Name alias",
      // "Alternative name"). Never auto-apply those — force human review so a
      // parallel field can't appear silently.
      if (!profileFieldsRegistry.isKnown(f.category_slug, f.label)) {
        console.log(`[profile-extract] Unknown label "${f.label}" in ${f.category_slug} — forcing review`);
        (f as any)._unknownLabel = true;
      }


      // Blocked labels never become profile entries. Relationship edges are
      // re-routed into the relationship graph; everything else is dropped.
      if (isBlockedProfileLabel(f.label)) {
        const relLabel = blockedLabelAsRelationship(f.label);
        if (relLabel && f.value && /^[\p{L}][\p{L}\p{M}'’.\- ]{0,60}$/u.test(f.value)) {
          extractedRelationships.push({
            person_a: f.contact_name,
            person_b: f.value,
            label_a_to_b: relLabel,
            label_b_to_a: inverseLabel(relLabel),
             source_quote: "",
             source_context: "",
          });
          console.log(`[profile-extract] Rerouted blocked label "${f.label}" → relationship ${relLabel}`);
        } else {
          console.log(`[profile-extract] Dropping fact: blocked label "${f.label}"`);
        }
        continue;
      }

      // Personality traits must describe a stable, general characteristic —
      // never a bare adjective distilled from one situational remark.
      if (f.category_slug === "personality" && isOvergeneralizedTrait(f.value, cleanContent)) {
        console.log(`[profile-extract] Dropping overgeneralized trait "${f.label}: ${f.value}"`);
        continue;
      }

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

      // Admission gate: one row = one fact, filed where its TYPE says it
      // belongs. A model that answers "Full name" with a name + an email + an
      // occupation yields three separately-filed facts here, not one wall.
      const gated = gateStoredValue({
        label: f.label,
        categorySlug: f.category_slug,
        value: f.value,
      });
      for (const g of gated) {
        if (!g.accepted) {
          console.log(`[profile-extract] Dropping fact "${f.label}: ${g.value}" (${g.reason})`);
          continue;
        }
        if (g.label !== f.label || g.categorySlug !== f.category_slug) {
          console.log(`[profile-extract] Refiled "${f.label}" → "${g.label}" (${g.categorySlug})`);
        }
        validFacts.push({
          ...f,
          label: g.label,
          category_slug: g.categorySlug,
          value: g.value,
          _target: target,
        });
      }

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
    // Why each fact was let go, so a total wipeout can never look like a quiet
    // success again. `noQuote` counts facts the model returned with no
    // source_quote at all, which is the signature of a live prompt that does not
    // ask for the field; `unverifiableQuote` counts quotes that were returned but
    // could not be found verbatim in the note.
    const dropped = { deduped: 0, noQuote: 0, unverifiableQuote: 0, perContactCap: 0 };

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
        dropped.deduped++;
        console.log(`[profile-extract] dedup skip (${dd.reason}) "${fact.label}: ${fact.value}" for ${target.canonical_name}`);
        continue;
      }
      // Use the (possibly narrowed) value returned by the guard — for a
      // list label with partial overlap this drops the tokens already known.
      const effectiveValue = dd.value;
      const factSourceQuote = String(fact.source_quote || "").trim();
      if (!exactQuoteExists(cleanContent, factSourceQuote)) {
        if (!factSourceQuote) {
          dropped.noQuote++;
          console.log(`[profile-extract] dropped "${fact.label}: ${effectiveValue}" — model returned no source_quote`);
        } else {
          dropped.unverifiableQuote++;
          console.log(`[profile-extract] dropped "${fact.label}: ${effectiveValue}" — source_quote not found verbatim in note: ${JSON.stringify(factSourceQuote.slice(0, 120))}`);
        }
        continue;
      }

      const count = perTargetCount.get(tKey) || 0;
      if (count >= MAX_FACTS_PER_CONTACT_PER_NOTE) {
        dropped.perContactCap++;
        continue;
      }
      perTargetCount.set(tKey, count + 1);

      const catRow = existingCategories.find(
        (c: any) => c.slug === fact.category_slug && (c.contact_id || null) === target.contact_id,
      );

      const ownerLabelName = target.is_self ? "your" : `${target.canonical_name}'s`;
      const isUnknownLabel = Boolean((fact as any)._unknownLabel);

      if (isUnknownLabel) {
        // Unknown labels in structured categories become a "new field proposal"
        // so the user decides whether to map it to an existing field or create
        // a new one. The fact is NOT pre-applied to the profile.
        suggestions.push({
          user_id: userId,
          source_note_id: noteId,
          suggestion_type: "unknown_profile_field",
          title: `New profile field: ${fact.label}`,
          description: `"${effectiveValue}" — extracted from "${noteTitle}"`,
          payload: {
            contact_id: target.contact_id,
            contact_name: target.canonical_name,
            is_owner: target.contact_id === null,
            category_slug: fact.category_slug,
            category_id: catRow?.id || null,
            label: fact.label,
            canonical_label: fact.label,
            value: effectiveValue,
            evidence_quote: factSourceQuote,
          },
          status: "pending_review",
          target_entity_type: "profile_entry",
          source_title: noteTitle,
          extracted_value: `${fact.label}: ${effectiveValue}`,
          confidence_score: 0.2,
          is_sensitive: isSensitiveSuggestion("unknown_profile_field", { ...(fact as unknown as Record<string, unknown>), value: effectiveValue }, noteContent),
          suppression_key: buildSuppressionKey("unknown_profile_field", target.contact_id ? "contact" : "owner", target.contact_id, `${fact.label}:${effectiveValue}`),
        });
      } else {
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
            evidence_quote: factSourceQuote,
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
    }


    if (suggestions.length > 0) {
      const unsuppressed = await filterSuppressedSuggestions(userId, suggestions);
      const prepared = await Promise.all(unsuppressed.map((s) => prepareSuggestionForInsert(s, preferences)));
      const { error } = await supabase.from("review_queue").insert(prepared);
      if (error) console.error("Profile suggestion insert error:", error);
      else console.log(`Created ${prepared.length} profile suggestions for note ${noteId}`);
    } else if (validFacts.length === 0) {
      console.log(`[profile-extract] no valid facts to consider for note ${noteId}`);
    } else if (dropped.noQuote === validFacts.length) {
      // The failure that hid for eight days. Say it out loud.
      console.error(
        `[profile-extract] DROPPED ALL ${validFacts.length}/${validFacts.length} facts for note ${noteId}: the model returned no source_quote for any of them. The live prompt for process-note.profile_extraction is probably missing the source_quote field — check llm_call_configs.`,
      );
    } else if (dropped.deduped === validFacts.length) {
      console.log(`[profile-extract] all ${validFacts.length} facts already known for note ${noteId} (deduped)`);
    } else {
      console.log(
        `[profile-extract] no suggestions for note ${noteId} from ${validFacts.length} valid facts — deduped ${dropped.deduped}, no source_quote ${dropped.noQuote}, unverifiable quote ${dropped.unverifiableQuote}, over per-contact cap ${dropped.perContactCap}`,
      );
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
      // Same reasoning as the fact loop: one rejection is routine, every
      // candidate rejected for the same reason is a broken prompt, and until now
      // the two looked identical in the log.
      let relNoQuote = 0;
      for (const rel of extractedRelationships) {
        if (!exactQuoteExists(cleanContent, rel.source_quote)) {
          if (!String(rel.source_quote || "").trim()) relNoQuote++;
          console.log(`[relationships] Rejected candidate without a verifiable exact quote: ${rel.person_a} / ${rel.person_b}`);
          continue;
        }
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
        const adjudication = await adjudicateRelationship({
          db: supabase,
          userId,
          candidate: {
            personA: nameA,
            personB: nameB,
            label: canonical,
            inverseLabel: inverse,
            sourceQuote: rel.source_quote,
            sourceContext: rel.source_context,
          },
        });
        const adjudicatedLabel = adjudication.canonicalLabel || canonical;

        const { data: evidenceRow, error: evidenceError } = await supabase
          .from("relationship_evidence")
          .upsert({
            user_id: userId,
            source_note_id: noteId,
            source_quote: rel.source_quote,
            source_context: rel.source_context || null,
            proposed_label: canonical,
            adjudicated_label: adjudicatedLabel,
            outcome: adjudication.outcome,
            reason: adjudication.reason,
            real_person_a: ["real_person", "public_person"].includes(adjudication.personAKind),
            real_person_b: ["real_person", "public_person"].includes(adjudication.personBKind),
            personally_relevant: adjudication.personallyRelevant,
            relationship_supported: adjudication.relationshipSupported,
            incidental_or_transactional: adjudication.incidentalOrTransactional,
            fictional_or_roleplay: adjudication.fictionalOrRoleplay,
            confidence: adjudication.confidence,
            adjudication_version: RELATIONSHIP_ADJUDICATION_VERSION,
            note_content_hash: noteContentHash(cleanContent),
          }, { onConflict: "user_id,source_note_id,proposed_label,note_content_hash,source_quote" })
          .select("id")
          .single();
        if (evidenceError) console.error("[relationships] Evidence write failed", evidenceError);

        const contactClassifications = [
          contactA ? { id: contactA.id, kind: adjudication.personAKind } : null,
          contactB ? { id: contactB.id, kind: adjudication.personBKind } : null,
        ].filter((value): value is { id: string; kind: typeof adjudication.personAKind } => value !== null);
        for (const classification of contactClassifications) {
          await supabase.from("contacts").update({
            entity_kind: classification.kind,
            entity_confidence: adjudication.confidence,
            entity_reason: adjudication.reason,
            entity_classified_at: new Date().toISOString(),
          }).eq("id", classification.id).eq("user_id", userId);
        }

        if (adjudication.outcome === "reject") {
          console.log(`[relationships] Adjudicator rejected ${nameA} / ${nameB}: ${adjudication.reason}`);
          continue;
        }
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
            label: adjudicatedLabel,
            // Only suggest a mirror for asymmetric labels
            inverse_label: isSymmetricLabel(canonical) ? null : inverse,
            inverse_source_type: isSelfB ? "self" : "contact",
            inverse_source_id: isSelfB ? null : contactB!.id,
            inverse_target_type: isSelfA ? "self" : "contact",
            inverse_target_id: isSelfA ? null : contactA!.id,
            contact_name_a: nameA,
            contact_name_b: nameB,
            evidence_id: evidenceRow?.id || null,
            evidence_quote: rel.source_quote,
            evidence_context: rel.source_context || null,
            adjudication_reason: adjudication.reason,
            adjudication_outcome: adjudication.outcome,
            adjudication_confidence: adjudication.confidence,
          },
          status: "pending_review",
          target_entity_type: "relationship",
          source_title: noteTitle,
          extracted_value: `${nameA} ${canonical} ${nameB}`,
          confidence_score: adjudication.confidence,
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
      } else if (relNoQuote === extractedRelationships.length && extractedRelationships.length > 0) {
        // Blocked-label reroutes are pushed with an empty quote on purpose, so
        // this only reads as a prompt fault when the model itself returned none.
        console.error(
          `[relationships] DROPPED ALL ${extractedRelationships.length}/${extractedRelationships.length} candidates for note ${noteId}: not one carried a source_quote. If these came from the model rather than from a blocked-label reroute, the live prompt for process-note.profile_extraction is missing the source_quote field.`,
        );
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
        noteId,
        messages: [{ role: "user", content: userPrompt }],
        defaults: {
          provider: "openrouter",
          model: "deepseek/deepseek-v4-flash",
          systemPrompt: PROCESS_NOTE_MOMENT_PROMPT,
        },
        // A moment's title and description are free text, and add_moment is in
        // AUTO_APPLY_THRESHOLDS, so this one writes to the timeline without a
        // review card. It had the same missing language rule as the removed
        // world extractor, with nothing on screen to make it visible.
        systemSuffix: outputLanguageRule(preferences.profileLanguage),
        callOptions: { response_format: { type: "json_object" } },
      });
      parsed = parseModelJson<any>(result.content);
      if (parsed === null) {
        console.error(`[moment-extract] model returned no parseable JSON for note ${noteId}; first 200 chars: ${JSON.stringify(String(result.content ?? "").slice(0, 200))}`);
        return;
      }
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


/* ── World ──
   There is deliberately no world extractor here.

   The 2026-08-11 design gave World its own `entities` / `claims` store and a
   note reader that filed every non-person thing it saw into the review queue.
   The 2026-08-16 rewrite replaced that: World is now a view over rows that
   already exist (contacts, moments, profile_entries, contact_relationships).
   See the header of
   supabase/migrations/20260816120000_9a3f61c2-4d70-4c88-9b21-7e0a5c1d3f84.sql:
   "World is a view over rows that already exist. It is not a new store and it
   has no extractor of its own."

   The reader outlived that rewrite by one day and flooded the review queue with
   `add_entity` / `add_claim` cards that could never auto-apply
   (prepareSuggestionForInsert has no branch for either type), so every one of
   them sat pending forever. It is removed here.

   A non-person thing reaches World by hand (useCreateEntity) or through the MCP
   `create_entity` tool. Confirming a person once is enough: they reach World
   through the view, with no second confirmation. */

/* ── Processing-state helpers ── */
const MIN_WORDS_FOR_PROCESSING = 3;

async function setProcessingState(
  noteId: string,
  status: string,
  extra: Record<string, unknown> = {},
) {
  try {
    await supabase.from("notes").update({ processing_status: status, ...extra }).eq("id", noteId);
  } catch (err) {
    console.warn("failed to set processing_status", noteId, status, err);
  }
}

/* ── Main background processor ── */
/**
 * How long a claim can sit before another run may take it. Must match
 * sweep-note-processing's STUCK_MS, which is what decides a note is stuck and
 * re-triggers it; a shorter value here would let two runs overlap again, and a
 * longer one would make the sweep re-trigger notes this function then refuses.
 */
const CLAIM_STALE_MS = 10 * 60_000;

/**
 * Take exclusive ownership of a note before spending anything on it.
 *
 * The content-hash check in processInBackground stops a re-run of a version we
 * already finished. It cannot stop two runs STARTING at once, which is the race
 * its own comment describes: the client flush and the sweep both fire, both
 * read a status that is not yet "processing", both proceed, and the note is
 * embedded and extracted twice at double the credit cost.
 *
 * The conditional update collapses that read-then-write into one statement, so
 * exactly one caller gets a row back.
 *
 * The or() is what stops the claim becoming a deadlock. A run that dies
 * mid-flight leaves the status at "processing" forever, and a bare
 * `neq("processing_status", "processing")` would then refuse every retry.
 * `is.null` is in there because a legacy note has no status at all, and in SQL
 * `NULL <> 'processing'` is NULL rather than true, so neq alone would skip it.
 */
async function claimNoteForProcessing(
  noteId: string,
  attemptsSoFar: number,
): Promise<boolean> {
  const staleBefore = new Date(Date.now() - CLAIM_STALE_MS).toISOString();
  const { data, error } = await supabase
    .from("notes")
    // The attempt is counted here, at the moment the note is claimed, because
    // this is the last point before money is spent. It is reset to 0 on success
    // below. `sweep-note-processing` stops re-triggering at 3, so a note that can
    // never be processed stops costing an extraction on every sweep forever.
    .update({
      processing_status: "processing",
      processing_error: null,
      processing_attempts: attemptsSoFar + 1,
    })
    .eq("id", noteId)
    .or(
      `processing_status.is.null,processing_status.neq.processing,updated_at.lt.${staleBefore}`,
    )
    .select("id");

  if (error) {
    console.warn("failed to claim note for processing", noteId, error.message);
    return false;
  }
  const won = Array.isArray(data) && data.length > 0;
  if (!won) console.log(`process-note: ${noteId} is already being processed, skipping`);
  return won;
}

async function processInBackground(noteId: string, authHeader: string, force = false) {
  let contentHash: string | null = null;
  try {
    const { data: note, error: fetchErr } = await supabase
      .from("notes")
      .select("id, title, content, user_id, metadata, source_app, is_external, ai_visibility, created_at, processing_status, processed_hash, embedding, processing_attempts")
      .eq("id", noteId)
      .single();

    if (fetchErr || !note) {
      console.error("Note not found:", noteId);
      return;
    }

    const aiHidden = (note as any).ai_visibility === "hidden";

    let fullText = `${note.title}\n\n${note.content}`.trim();
    if (!fullText) {
      await setProcessingState(noteId, "skipped_empty", { processing_error: null });
      return;
    }

    // Idempotency: never re-spend credits on a content version we already
    // processed (the client flush and the server sweep can both fire).
    contentHash = noteContentHash(`${note.title ?? ""}\n\n${note.content ?? ""}`);
    if (
      !force &&
      (note as any).processing_status === "processed" &&
      (note as any).processed_hash === contentHash &&
      (note as any).embedding
    ) {
      console.log("process-note: already processed this content version:", noteId);
      return;
    }

    const wordCount = fullText.split(/\s+/).filter(Boolean).length;
    if (wordCount < MIN_WORDS_FOR_PROCESSING) {
      await setProcessingState(noteId, "skipped_short", { processed_hash: contentHash, processing_error: null });
      return;
    }

    // Claim it before spending. `force` is the deliberate admin re-run and
    // keeps its existing override.
    if (force) {
      // The deliberate admin re-run is never capped, and resets the count so a
      // note a human has just fixed gets a clean slate.
      await setProcessingState(noteId, "processing", {
        processing_error: null,
        processing_attempts: 0,
      });
    } else if (!(await claimNoteForProcessing(noteId, Number((note as any).processing_attempts) || 0))) {
      return;
    }

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
      await setProcessingState(noteId, "skipped_no_credits");
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
        noteId,
        messages: [{ role: "user", content: fullText.slice(0, 24000) }],
        defaults: {
          provider: "openrouter",
          model: "deepseek/deepseek-v4-flash",
          systemPrompt: PROCESS_NOTE_METADATA_PROMPT,
        },
        // `content_mode` drives the fiction gate in generateReviewItems, so it is
        // demanded here rather than only in the prompt above: this call site has
        // a row in llm_call_configs that never asked for the field, which left
        // both fiction gates permanently off.
        systemSuffix: [metadataFieldContract(), sourceLanguageRule()].join("\n\n"),
        callOptions: { response_format: { type: "json_object" } },
      });

      metadata = parseModelJson<Record<string, unknown>>(chatResult.content) ?? {};
      if (Object.keys(metadata).length === 0) {
        // The old code fell back silently here, so a note whose metadata pass
        // returned junk looked identical to one with genuinely nothing to say,
        // and content_mode went missing without a trace.
        console.error(
          `[process-note] metadata pass returned no parseable JSON for note ${noteId}; falling back to defaults. First 200 chars: ${JSON.stringify(String(chatResult.content ?? "").slice(0, 200))}`,
        );
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
        await setProcessingState(noteId, "skipped_no_credits");
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

    // Update the note with embedding, metadata, and optionally a smarter title.
    //
    // `embedding` is only written when we actually produced one. It used to go
    // in unconditionally, so a chunking run that failed without throwing wrote
    // embedding: null and wiped a perfectly good vector off the note, taking it
    // out of note-level semantic search until something reprocessed it.
    const updatePayload: Record<string, unknown> = { metadata: mergedMetadata };
    if (embedding) updatePayload.embedding = embedding;
    if (aiTitle) updatePayload.title = aiTitle;
    // Hash the content version we actually processed. When the AI renames the
    // note we hash the new title, otherwise the sweep would see a mismatch and
    // reprocess (and re-charge) the same note forever.
    updatePayload.processing_status = "processed";
    updatePayload.processed_at = new Date().toISOString();
    updatePayload.processed_hash = noteContentHash(
      `${aiTitle || note.title || ""}\n\n${note.content ?? ""}`,
    );
    updatePayload.processing_error = null;
    // Succeeded, so the strike count goes back to zero.
    updatePayload.processing_attempts = 0;

    const { error: updateErr } = await supabase
      .from("notes")
      .update(updatePayload)
      .eq("id", noteId);

    if (updateErr) {
      console.error("Update error:", updateErr);
      await setProcessingState(noteId, "failed", { processing_error: updateErr.message });
      return;
    }


    // AI-hidden notes: keep embeddings (local search) but skip every downstream
    // AI surface — review queue, profile suggestions, knowledge graph connections.
    //
    // Notes synced from Michael's hub take the same exit, for a different
    // reason. They are indexed so search can find them, which is the whole
    // point of syncing them, but they must never be mined for facts: the hub's
    // observations are an AI's guesses about him, and extracting claims from
    // them would let the system cite its own guesses back as things he said.
    const hubSourced = !shouldExtractFacts((note as any).source_app);
    if (aiHidden || hubSourced) {
      console.log(
        "process-note: embedded, skipping AI-derivative work for",
        noteId,
        aiHidden ? "(ai_visibility=hidden)" : "(synced from the hub)",
      );
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

    // Promote whatever facts this note just produced into dated claims.
    //
    // THE LAST HOP, and it was missing until 2026-08-31. Extraction from a note
    // was never the gap: generateProfileSuggestions above writes a fact into
    // profile_entries with origin 'ai_note', the sentence it came from, and
    // linked_note_id pointing back here. But profile_entries stopped being a
    // fact store in migration 093000 and became a display layer over `claims`,
    // and nothing carried a row across. So a fact extracted from a note reached
    // the display layer and stopped there: undated, with no cardinality and no
    // review date, invisible to search_claims and to the hub mirror's dated arm.
    // That is rot type 3a in SPEC.md — the value exists in a note and was never
    // promoted — and this call is what closes it for every new fact.
    //
    // Idempotent and cheap in the steady state: the promotion skips every entry
    // that already has a claim, so a note that produced no new fact costs one
    // scan and zero embeddings. Fire-and-forget, because a claim is a
    // convenience over rows that already exist and must never fail the note.
    //
    // Logged the way compute-connections is, and for the same reason: fetch()
    // only rejects on a transport error, so a 4xx/5xx would otherwise vanish.
    fetch(`${SUPABASE_URL}/functions/v1/promote-profile-entries`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        dry_run: false,
        include_contacts: true,
        target_user_id: note.user_id,
      }),
    })
      .then(async (r) => {
        if (!r.ok) {
          console.error(
            `promote-profile-entries rejected note=${noteId}: ${r.status} ${await r.text().catch(() => "")}`,
          );
        }
      })
      .catch((err) => console.error("promote-profile-entries trigger error:", err));

    // Trigger connection computation (fire-and-forget, but never silent).
    //
    // fetch() only rejects on a transport error, so an HTTP 4xx/5xx from the
    // callee used to vanish with no log line at all. That is how every
    // sweep-processed note silently missed the knowledge graph for as long as
    // it did: compute-connections answered 401 and the .catch() never fired.
    const computeUrl = `${SUPABASE_URL}/functions/v1/compute-connections`;
    fetch(computeUrl, {
      method: "POST",
      headers: {
        Authorization: authHeader,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ note_id: noteId }),
    })
      .then(async (r) => {
        if (!r.ok) {
          console.error(
            `compute-connections rejected note=${noteId}: ${r.status} ${await r.text().catch(() => "")}`,
          );
        }
      })
      .catch((err) => console.error("compute-connections trigger error:", err));

    console.log("process-note completed for:", noteId);
  } catch (err) {
    console.error("Background processing error:", err);
    await setProcessingState(noteId, "failed", {
      processing_error: err instanceof Error ? err.message.slice(0, 500) : "Unknown error",
    });
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

    const { note_id, force } = await req.json();
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
    EdgeRuntime.waitUntil(processInBackground(note_id, authHeader, Boolean(force)));

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
