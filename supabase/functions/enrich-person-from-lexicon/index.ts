// Enrich a single person/contact using ALL available evidence:
// - their Lexicon page (wiki_pages where page_type='person' and title matches)
// - other Lexicon pages that mention them
// - timeline moments where they are a participant
// - notes that mention them
// - existing profile entries and relationships (for dedup)
//
// Produces add_profile_entry and add_relationship review_queue suggestions
// (or auto-applies them when prefs allow), with canonical labels and
// symmetric-pair deduplication so we never create duplicate spouse/lover/etc.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { checkBalance, insufficientCreditsResponse } from "../_shared/llm-credits.ts";
import { runChat } from "../_shared/llm-router.ts";
import {
  CANONICAL_LABELS_FOR_PROMPT,
  canonicalProfileLabel,
  correctProfileCategory,
  isSingleValueLabel,
  normalizeProfileValueForDedup,
} from "../_shared/profile-canonical-schema.ts";
import {
  applyNormalization,
  createNormalizationSuggestions,
  type NormalizationPayload,
} from "../_shared/profile-normalization.ts";
import { profileValueDecision, relationshipWriteDecision } from "../_shared/profile-integrity.ts";
import { adjudicateRelationship } from "../_shared/relationship-adjudicator.ts";
import { ilikeContains } from "../_shared/postgrest-filters.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

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

const PROFILE_CATEGORY_SLUGS = [
  "identity", "location", "professional", "education", "relationships",
  "communication", "personality", "principles", "health", "hobbies",
  "food", "entertainment", "travel", "digital", "financial", "goals", "preferences",
];

const PROMPT = `You are extracting biographical facts and relationships about ONE specific person from a bundle of evidence (a Lexicon page about them, related Lexicon pages, timeline moments, notes, and attachment OCR text).

Return a JSON object with two keys:
1. "facts": array of { contact_name, category_slug (one of: ${PROFILE_CATEGORY_SLUGS.join(", ")}), label, value, source_quote }
2. "relationships": array of { person_a, person_b, label_a_to_b, label_b_to_a }

Reasoning rules — apply common sense across ALL evidence, not just one source:
- Marriage cues anywhere in the evidence — "wife", "husband", "married", "wedding day", "spouse", "anniversary", "Marriage Papers", "Heirat", "Hochzeit", "Ehefrau", "Ehemann" — imply a SPOUSE relationship between the named people. A note titled "Marriage Papers X and Y" plus a wedding-day moment is direct proof.
- Use "me"/"myself" for the note author when the evidence refers to them in first person ("my wife X") or by their display name.
- Prefer the strongest label: spouse > partner > lover. If the evidence clearly says "wife"/"husband"/"married", emit "spouse" (not "lover" or "partner").
- If multiple sources independently support a relationship, you should still emit it once.
- Use standard relationship labels: spouse, partner, lover, friend, mother, father, parent, child, son, daughter, brother, sister, sibling, mentor, mentee, manager, report, employee, employer, co-worker, neighbor, roommate, client, provider, teacher, student.
- Do NOT invent facts. If unsure, skip.
- Every fact must include the shortest exact verbatim source_quote from the supplied evidence. If no exact quote proves it, do not emit it.
- "value" must contain ONLY the fact itself. Strip editorial, joking, or parenthetical commentary: emit 5'4", NOT 5'4" (fun sized).
- Emit each distinct fact ONCE, even when several sources state it.
- Return empty arrays if nothing qualifies.

CANONICAL LABELS — prefer these EXACT label names when one fits the fact:
${CANONICAL_LABELS_FOR_PROMPT}
When one of these fits, USE IT EXACTLY. Only use a natural label if none fits.`;

async function loadEvidence(userId: string, contactId: string) {
  const { data: contact } = await supabase
    .from("contacts")
    .select("id, name, aliases")
    .eq("id", contactId)
    .eq("user_id", userId)
    .maybeSingle();
  if (!contact) return null;

  const names = [contact.name, ...((contact as any).aliases || [])].filter(Boolean);

  // Lexicon page(s) for this person
  const slugCandidates = names.map((n: string) => n.toLowerCase().replace(/\s+/g, "-"));
  const { data: personPages } = await supabase
    .from("wiki_pages")
    .select("title, page_type, summary, content")
    .eq("user_id", userId)
    .or(`page_type.eq.person,page_type.eq.entity`)
    .or(names.map((n: string) => ilikeContains("title", n)).join(","))
    .limit(5);

  // Other lexicon pages mentioning the name
  const { data: otherPages } = await supabase
    .from("wiki_pages")
    .select("title, page_type, summary, content")
    .eq("user_id", userId)
    .or(names.map((n: string) => ilikeContains("content", n)).join(","))
    .limit(10);

  // Timeline moments where they participate
  const { data: participantRows } = await supabase
    .from("moment_participants")
    .select("moment_id")
    .eq("person_id", contactId);
  const momentIds = (participantRows || []).map((r: any) => r.moment_id);
  let moments: any[] = [];
  if (momentIds.length > 0) {
    const { data } = await supabase
      .from("moments")
      .select("title, description, happened_at, status, category")
      .in("id", momentIds)
      .is("deleted_at", null)
      .eq("ai_visibility", "visible")
      .order("happened_at", { ascending: false })
      .limit(40);
    moments = data || [];
  }

  // Notes that mention them — broadened: by metadata.matched_people OR by
  // ILIKE on title/content for any of the names/aliases. This catches notes
  // like "Marriage Papers Xihui and Michael" where matched_people was never
  // populated by the metadata pass at ingest time.
  const orClauses = names.flatMap((n: string) => [
    ilikeContains("title", n),
    ilikeContains("content", n),
  ]).join(",");
  const { data: nameMatchedNotes } = await supabase
    .from("notes")
    .select("id, title, content, metadata, created_at")
    .eq("user_id", userId)
    .eq("is_trashed", false)
    .eq("ai_visibility", "visible")
    .or(orClauses)
    .order("created_at", { ascending: false })
    .limit(60);

  const { data: matchedPeopleNotes } = await supabase
    .from("notes")
    .select("id, title, content, metadata, created_at")
    .eq("user_id", userId)
    .eq("is_trashed", false)
    .eq("ai_visibility", "visible")
    .order("created_at", { ascending: false })
    .limit(200);
  const filteredByMatched = (matchedPeopleNotes || []).filter((n: any) => {
    const matched = Array.isArray(n.metadata?.matched_people) ? n.metadata.matched_people : [];
    return matched.some((m: any) => m.contact_id === contactId);
  });

  const noteMap = new Map<string, any>();
  for (const n of [...(nameMatchedNotes || []), ...filteredByMatched]) {
    if (!noteMap.has(n.id)) noteMap.set(n.id, n);
  }
  const notes = Array.from(noteMap.values()).slice(0, 30);
  const noteIds = notes.map((n) => n.id);

  // Media OCR / extracted text for attachments in those notes — catches things
  // like the actual marriage certificate image.
  let mediaTexts: Array<{ note_id: string; description: string | null; extracted_text: string | null; original_filename: string | null }> = [];
  if (noteIds.length > 0) {
    const { data: media } = await supabase
      .from("media_analysis")
      .select("note_id, description, extracted_text, original_filename")
      .in("note_id", noteIds)
      .eq("user_id", userId)
      .eq("analysis_status", "complete")
      .limit(40);
    mediaTexts = (media || []) as any[];
  }

  // Existing profile entries (dedup) + categories + relationships
  const { data: existingEntries } = await supabase
    .from("profile_entries")
    .select("contact_id, label, value, category_id")
    .eq("user_id", userId)
    .eq("contact_id", contactId);
  const { data: existingCategories } = await supabase
    .from("profile_categories")
    .select("id, slug, contact_id")
    .eq("user_id", userId)
    .eq("contact_id", contactId);
  const { data: existingRels } = await supabase
    .from("contact_relationships")
    .select("source_type, source_id, target_type, target_id, label")
    .eq("user_id", userId);

  // Self display name for self-aliases
  const { data: selfProfile } = await supabase
    .from("profiles")
    .select("display_name")
    .eq("id", userId)
    .maybeSingle();

  return {
    contact,
    names,
    personPages: personPages || [],
    otherPages: (otherPages || []).filter((p: any) => !((personPages || []).some((pp: any) => pp.title === p.title))),
    moments,
    notes,
    mediaTexts,
    existingEntries: existingEntries || [],
    existingCategories: existingCategories || [],
    existingRels: existingRels || [],
    selfDisplayName: ((selfProfile as any)?.display_name as string | undefined) || "Me",
  };
}

function truncate(s: string, n: number) {
  if (!s) return "";
  return s.length > n ? s.slice(0, n) + "…" : s;
}

function buildPrompt(evidence: NonNullable<Awaited<ReturnType<typeof loadEvidence>>>) {
  const parts: string[] = [];
  parts.push(`Target person: ${evidence.contact.name}`);
  if ((evidence.contact as any).aliases?.length) {
    parts.push(`Aliases: ${(evidence.contact as any).aliases.join(", ")}`);
  }
  parts.push(`Note author (self / "me" / "I"): ${evidence.selfDisplayName}`);

  if (evidence.personPages.length) {
    parts.push(`\n=== Lexicon pages about this person ===`);
    for (const p of evidence.personPages) {
      parts.push(`# ${p.title}\n${truncate((p as any).summary || "", 400)}\n${truncate((p as any).content || "", 1500)}`);
    }
  }
  if (evidence.otherPages.length) {
    parts.push(`\n=== Related Lexicon pages mentioning ${evidence.contact.name} ===`);
    for (const p of evidence.otherPages.slice(0, 6)) {
      parts.push(`# ${p.title}\n${truncate((p as any).summary || "", 200)}\n${truncate((p as any).content || "", 500)}`);
    }
  }
  if (evidence.moments.length) {
    parts.push(`\n=== Timeline moments with ${evidence.contact.name} ===`);
    for (const m of evidence.moments.slice(0, 20)) {
      parts.push(`- ${m.happened_at?.slice(0, 10)} [${m.status}] ${m.title}${m.description ? ` — ${truncate(m.description, 200)}` : ""}`);
    }
  }
  if (evidence.notes.length) {
    parts.push(`\n=== Notes mentioning ${evidence.contact.name} ===`);
    for (const n of evidence.notes.slice(0, 20)) {
      parts.push(`# ${n.title}\n${truncate(n.content || "", 800)}`);
    }
  }
  if ((evidence as any).mediaTexts?.length) {
    parts.push(`\n=== Attachments (OCR / extracted text) in notes about ${evidence.contact.name} ===`);
    for (const m of (evidence as any).mediaTexts.slice(0, 20)) {
      const label = m.original_filename || "attachment";
      const body = [m.description, m.extracted_text].filter(Boolean).join("\n");
      if (body) parts.push(`# ${label}\n${truncate(body, 800)}`);
    }
  }
  return parts.join("\n");
}

/**
 * Count distinct pieces of evidence that strongly suggest a spouse/marriage
 * relationship between the target person and the note author. Used to boost
 * confidence of an LLM-emitted "spouse" suggestion to auto-apply territory.
 */
function countSpouseEvidence(evidence: NonNullable<Awaited<ReturnType<typeof loadEvidence>>>): number {
  const cues = /(\bwife\b|\bhusband\b|\bspouse\b|\bmarried\b|\bmarriage\b|\bwedding\b|\banniversary\b|\bheirat|\bhochzeit|\behefrau|\behemann|\bgattin|\bgatte)/i;
  let count = 0;
  for (const p of evidence.personPages) {
    if (cues.test(`${(p as any).title || ""}\n${(p as any).summary || ""}\n${(p as any).content || ""}`)) count++;
  }
  for (const p of evidence.otherPages) {
    if (cues.test(`${(p as any).title || ""}\n${(p as any).content || ""}`)) count++;
  }
  for (const m of evidence.moments) {
    if (cues.test(`${m.title || ""}\n${m.description || ""}\n${m.category || ""}`)) count++;
  }
  for (const n of evidence.notes) {
    if (cues.test(`${n.title || ""}\n${n.content || ""}`)) count++;
  }
  for (const m of ((evidence as any).mediaTexts || [])) {
    if (cues.test(`${m.original_filename || ""}\n${m.description || ""}\n${m.extracted_text || ""}`)) count++;
  }
  return count;
}

async function getPrefs(userId: string) {
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

const AUTO_APPLY: Record<string, Record<string, number>> = {
  add_profile_entry: { conservative: 0.78, balanced: 0.65, exploratory: 0.5 },
  add_relationship: { conservative: 0.80, balanced: 0.7, exploratory: 0.55 },
};

function threshold(type: string, sensitivity: string) {
  return AUTO_APPLY[type]?.[sensitivity] ?? 0.7;
}

// ── Normalization plumbing (mirrors normalize-profile/index.ts so the
// suppression keys and auto-apply thresholds stay compatible) ──

const SENSITIVE_TERMS = [
  "medical", "health", "diagnosis", "condition", "therapy", "depression", "anxiety", "mental",
  "pregnant", "pregnancy", "romantic", "sexual", "affair", "secret", "conflict", "legal", "lawsuit",
  "debt", "bankrupt", "financial hardship", "broke", "divorce", "addiction", "trauma",
];

function normalizeSuggestionValue(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value.trim().toLowerCase();
  try { return JSON.stringify(value).toLowerCase(); } catch { return String(value).toLowerCase(); }
}

function buildSuppressionKey(suggestionType: string, targetEntityType: string | null, targetEntityId: string | null, value: unknown) {
  return [suggestionType, targetEntityType || "none", targetEntityId || "none", normalizeSuggestionValue(value)].join(":");
}

function isSensitiveSuggestion(suggestionType: string, payload: Record<string, unknown>, text = "") {
  const haystack = `${suggestionType} ${text} ${Object.values(payload).join(" ")}`.toLowerCase();
  return SENSITIVE_TERMS.some((t) => haystack.includes(t));
}

async function filterSuppressedSuggestions(userId: string, suggestions: any[]) {
  if (suggestions.length === 0) return suggestions;
  const keys = suggestions.map((s) => s.suppression_key).filter(Boolean);
  if (keys.length === 0) return suggestions;
  const { data } = await supabase
    .from("ai_suggestion_suppressions")
    .select("suppression_key")
    .eq("user_id", userId)
    .in("suppression_key", keys);
  const blocked = new Set(((data || []) as any[]).map((r) => r.suppression_key));
  return suggestions.filter((s) => !s.suppression_key || !blocked.has(s.suppression_key));
}

const NORMALIZE_AUTO_APPLY: Record<string, number> = { conservative: 0.92, balanced: 0.85, exploratory: 0.75 };

async function prepareNormalizationSuggestion(
  s: any,
  prefs: { mode: string; sensitivity: string; autoAddSensitive: boolean },
) {
  const t = NORMALIZE_AUTO_APPLY[prefs.sensitivity] ?? 0.85;
  const confidence = s.confidence_score ?? 0;
  const canAuto = prefs.mode === "auto" && confidence >= t && (!s.is_sensitive || prefs.autoAddSensitive);
  if (!canAuto) return { ...s, status: "pending_review" };
  try {
    const result = await applyNormalization(supabase, s.payload as NormalizationPayload);
    if (result.ok && result.entryId) {
      return { ...s, status: "auto_applied_unreviewed", target_entity_id: result.entryId, applied_at: new Date().toISOString() };
    }
  } catch (e) {
    console.error("[enrich-person] normalize auto-apply failed:", e);
  }
  return { ...s, status: "pending_review" };
}

async function run(userId: string, contactId: string) {
  const balance = await checkBalance(supabase as any, userId);
  if (!balance.allowed) return { ok: false, reason: "insufficient_credits" };

  const evidence = await loadEvidence(userId, contactId);
  if (!evidence) return { ok: false, reason: "contact_not_found" };

  const prefs = await getPrefs(userId);
  if (prefs.mode === "off") return { ok: false, reason: "suggestions_off" };

  const userPrompt = buildPrompt(evidence);
  let parsed: any;
  try {
    const result = await runChat({
      db: supabase as any,
      userId,
      callSite: "enrich-person-from-lexicon",
      messages: [{ role: "user", content: userPrompt }],
      defaults: {
        provider: "openrouter",
        model: "deepseek/deepseek-v4-flash",
        systemPrompt: PROMPT,
      },
      callOptions: { response_format: { type: "json_object" } },
    });
    parsed = JSON.parse(result.content);
  } catch (err: any) {
    if (err?.message === "INSUFFICIENT_CREDITS") return { ok: false, reason: "insufficient_credits" };
    console.error("[enrich-person] LLM error", err);
    return { ok: false, reason: "llm_error" };
  }

  const rawFacts: any[] = Array.isArray(parsed?.facts) ? parsed.facts : [];
  const rawRels: any[] = Array.isArray(parsed?.relationships) ? parsed.relationships : [];

  const selfAliases = buildSelfAliases([evidence.selfDisplayName]);

  // Dedup keys for existing rels
  const relSeen = new Set<string>();
  for (const r of evidence.existingRels) {
    const a: EntityRef = { type: (r as any).source_type, id: (r as any).source_id };
    const b: EntityRef = { type: (r as any).target_type, id: (r as any).target_id };
    relSeen.add(relationshipPairKey(userId, a, b, (r as any).label));
  }
  const { data: queueRels } = await supabase
    .from("review_queue")
    .select("payload, status")
    .eq("user_id", userId)
    .eq("suggestion_type", "add_relationship")
    .in("status", ["pending", "pending_review", "auto_applied_unreviewed", "kept", "accepted"]);
  for (const q of queueRels || []) {
    const p = (q as any).payload || {};
    if (!p.source_type || !p.target_type || !p.label) continue;
    const a: EntityRef = { type: p.source_type, id: p.source_id || null };
    const b: EntityRef = { type: p.target_type, id: p.target_id || null };
    relSeen.add(relationshipPairKey(userId, a, b, p.label));
  }

  // Dedup keys for existing entries — canonical label + normalized value, so
  // "height | 5'4\" (fun sized)" and "Height | 5'4\"" collide instead of both
  // being inserted.
  const slugByCategoryId = new Map<string, string>(
    (evidence.existingCategories as any[]).map((c: any) => [c.id, c.slug]),
  );
  const canonLabelOfRow = (e: any): string => {
    const slug = slugByCategoryId.get(e.category_id) || "preferences";
    return canonicalProfileLabel(correctProfileCategory(e.label || "", slug), e.label || "");
  };
  const entrySeen = new Set<string>(
    evidence.existingEntries.map((e: any) =>
      `${canonLabelOfRow(e).toLowerCase()}|${normalizeProfileValueForDedup(e.value || "")}`),
  );
  // Canonical labels this person already has a value for — consulted for
  // [single] labels so we never add a second Height / Date of birth / etc.
  const singletonTaken = new Set<string>(
    evidence.existingEntries.map((e: any) => canonLabelOfRow(e).toLowerCase()),
  );

  // Also dedup against profile-entry suggestions already in the review queue
  // (re-running enrichment must not stack duplicate suggestions).
  const { data: queueEntries } = await supabase
    .from("review_queue")
    .select("payload, status")
    .eq("user_id", userId)
    .eq("suggestion_type", "add_profile_entry")
    .in("status", ["pending", "pending_review", "auto_applied_unreviewed", "kept", "blocked", "accepted", "dismissed"]);
  for (const q of (queueEntries || []) as any[]) {
    if (q.payload?.contact_id !== contactId) continue;
    const qSlug = String(q.payload?.category_slug || "preferences");
    const qLabel = canonicalProfileLabel(correctProfileCategory(String(q.payload?.label || ""), qSlug), String(q.payload?.label || ""));
    entrySeen.add(`${qLabel.toLowerCase()}|${normalizeProfileValueForDedup(String(q.payload?.value || ""))}`);
    if (["pending", "pending_review", "auto_applied_unreviewed", "kept", "accepted"].includes(q.status)) {
      singletonTaken.add(qLabel.toLowerCase());
    }
  }

  const targetNameLower = evidence.contact.name.toLowerCase();
  const aliasLowerSet = new Set<string>(
    [evidence.contact.name, ...((evidence.contact as any).aliases || [])].map((n: string) => n.toLowerCase()),
  );

  const suggestions: any[] = [];

  // Build profile facts (only for this contact)
  for (const f of rawFacts) {
    const name = String(f?.contact_name || "").trim().toLowerCase();
    let slug = String(f?.category_slug || "").trim().toLowerCase();
    let label = String(f?.label || "").trim();
    const value = String(f?.value || "").trim();
    const sourceQuote = String(f?.source_quote || "").trim();
    if (!name || !slug || !label || !value || sourceQuote.length < 10) continue;
    if (!PROFILE_CATEGORY_SLUGS.includes(slug)) continue;
    // Only accept facts about THIS person (alias-aware)
    if (!aliasLowerSet.has(name) && name !== targetNameLower) continue;

    // Canonicalize: fix obviously-wrong categories, then map the label onto
    // the shared canonical vocabulary (same post-pass as process-note).
    const correctedSlug = correctProfileCategory(label, slug);
    if (PROFILE_CATEGORY_SLUGS.includes(correctedSlug)) slug = correctedSlug;
    label = canonicalProfileLabel(slug, label);
    const labelLower = label.toLowerCase();

    const key = `${labelLower}|${normalizeProfileValueForDedup(value)}`;
    if (entrySeen.has(key)) continue;
    // One-truth-per-subject labels: never add a second Height / DOB / etc.
    if (isSingleValueLabel(label) && singletonTaken.has(labelLower)) continue;

    const catRow = evidence.existingCategories.find((c: any) => c.slug === slug);
    suggestions.push({
      user_id: userId,
      source_note_id: null,
      suggestion_type: "add_profile_entry",
      title: `Add to ${evidence.contact.name}'s profile: ${label}`,
      description: `"${value}" — extracted via Lexicon-aware enrichment`,
      payload: {
        contact_id: evidence.contact.id,
        contact_name: evidence.contact.name,
        category_slug: slug,
        category_id: catRow?.id || null,
        label,
        value,
        evidence_quote: sourceQuote,
        source: "lexicon_enrichment",
      },
      status: "pending_review",
      target_entity_type: "profile_entry",
      source_title: "Lexicon & timeline enrichment",
      extracted_value: `${label}: ${value}`,
      confidence_score: 0.82,
      is_sensitive: false,
    });
    entrySeen.add(key);
    singletonTaken.add(labelLower);
  }

  // Relationships (allow self↔contact)
  for (const rel of rawRels) {
    const rawA = String(rel?.person_a || "").trim();
    const rawB = String(rel?.person_b || "").trim();
    if (!rawA || !rawB) continue;
    const isSelfA = isSelfName(rawA, selfAliases);
    const isSelfB = isSelfName(rawB, selfAliases);
    if (isSelfA && isSelfB) continue;

    const matchEntity = (name: string): { type: "contact"; id: string; name: string } | null => {
      const lower = name.toLowerCase();
      if (aliasLowerSet.has(lower) || lower === targetNameLower) {
        return { type: "contact", id: evidence.contact.id, name: evidence.contact.name };
      }
      return null;
    };
    const a = isSelfA ? null : matchEntity(rawA);
    const b = isSelfB ? null : matchEntity(rawB);
    // Require at least the target person to be involved (the one we're enriching)
    if (!isSelfA && !a) continue;
    if (!isSelfB && !b) continue;
    if (a && b && a.id === b.id) continue;
    const targetInvolved = (a && a.id === evidence.contact.id) || (b && b.id === evidence.contact.id);
    if (!targetInvolved) continue;

    const canonical = canonicalLabel(rel?.label_a_to_b);
    if (!canonical) continue;
    const inverse = canonicalLabel(rel?.label_b_to_a) || inverseLabel(canonical);

    const aRef: EntityRef = { type: isSelfA ? "self" : "contact", id: isSelfA ? null : a!.id };
    const bRef: EntityRef = { type: isSelfB ? "self" : "contact", id: isSelfB ? null : b!.id };
    const pairKey = relationshipPairKey(userId, aRef, bRef, canonical);
    if (relSeen.has(pairKey)) continue;
    relSeen.add(pairKey);

    const nameA = isSelfA ? evidence.selfDisplayName : a!.name;
    const nameB = isSelfB ? evidence.selfDisplayName : b!.name;

    suggestions.push({
      user_id: userId,
      source_note_id: null,
      suggestion_type: "add_relationship",
      title: `Add relationship: ${nameA} → ${nameB} (${canonical})`,
      description: `${nameA} is ${canonical} of ${nameB} — extracted via Lexicon-aware enrichment`,
      payload: {
        source_type: aRef.type,
        source_id: aRef.id,
        target_type: bRef.type,
        target_id: bRef.id,
        label: canonical,
        inverse_label: isSymmetricLabel(canonical) ? null : inverse,
        contact_name_a: nameA,
        contact_name_b: nameB,
        source: "lexicon_enrichment",
      },
      status: "pending_review",
      target_entity_type: "relationship",
      source_title: "Lexicon & timeline enrichment",
      extracted_value: `${nameA} ${canonical} ${nameB}`,
      confidence_score: (canonical === "spouse" || canonical === "partner") && countSpouseEvidence(evidence) >= 2 ? 0.95 : 0.85,
      is_sensitive: false,
    });
  }

  // Evidence-only fallback: if the LLM didn't emit a spouse relationship but
  // we have multiple strong pieces of evidence (marriage papers + wedding
  // moment, etc.) AND the note author is involved, synthesize one. This is the
  // "common sense" pass that prevents the AI from missing what a human would
  // immediately see.
  const hasSpouseSuggestion = suggestions.some(
    (s) => s.suggestion_type === "add_relationship" && (s.payload?.label === "spouse" || s.payload?.label === "partner"),
  );
  const hasExistingSpouse = Array.from(relSeen).some((k) => k.includes("|spouse|") || k.includes("|partner|"));
  if (!hasSpouseSuggestion && !hasExistingSpouse && countSpouseEvidence(evidence) >= 2) {
    const aRef: EntityRef = { type: "self", id: null };
    const bRef: EntityRef = { type: "contact", id: evidence.contact.id };
    const pairKey = relationshipPairKey(userId, aRef, bRef, "spouse");
    if (!relSeen.has(pairKey)) {
      relSeen.add(pairKey);
      suggestions.push({
        user_id: userId,
        source_note_id: null,
        suggestion_type: "add_relationship",
        title: `Add relationship: ${evidence.selfDisplayName} → ${evidence.contact.name} (spouse)`,
        description: `Multiple notes / moments reference a marriage between ${evidence.selfDisplayName} and ${evidence.contact.name}.`,
        payload: {
          source_type: aRef.type,
          source_id: aRef.id,
          target_type: bRef.type,
          target_id: bRef.id,
          label: "spouse",
          inverse_label: null,
          contact_name_a: evidence.selfDisplayName,
          contact_name_b: evidence.contact.name,
          source: "evidence_synthesis",
        },
        status: "pending_review",
        target_entity_type: "relationship",
        source_title: "Lexicon & timeline enrichment",
        extracted_value: `${evidence.selfDisplayName} spouse ${evidence.contact.name}`,
        confidence_score: 0.95,
        is_sensitive: false,
      });
    }
  }

  // Auto-apply where confidence + prefs allow
  let autoApplied = 0;
  const prepared: any[] = [];
  for (const s of suggestions) {
    const t = threshold(s.suggestion_type, prefs.sensitivity);
    const canAuto = prefs.mode === "auto" && (s.confidence_score ?? 0) >= t && (!s.is_sensitive || prefs.autoAddSensitive);
    if (!canAuto) { prepared.push({ ...s, status: "pending_review" }); continue; }
    try {
      if (s.suggestion_type === "add_profile_entry") {
        if (!s.payload.category_id) { prepared.push({ ...s, status: "pending_review" }); continue; }
        const fact = profileValueDecision(String(s.payload.category_slug || ""), String(s.payload.label || ""), String(s.payload.value || ""));
        if (!fact.ok) { prepared.push({ ...s, status: "removed" }); continue; }
        const factEvidenceQuote = String((s.payload as any).evidence_quote || "").trim();
        if (factEvidenceQuote.length < 10) { prepared.push({ ...s, status: "pending_review" }); continue; }
        const { data, error } = await supabase
          .from("profile_entries")
          .insert({ user_id: userId, contact_id: s.payload.contact_id, category_id: s.payload.category_id, label: fact.label, value: fact.value, sort_order: 0, origin: "ai_lexicon", evidence_quote: factEvidenceQuote })
          .select("id")
          .single();
        if (error && (error as any).code === "23505") { prepared.push({ ...s, status: "removed" }); continue; }
        if (error || !data) { prepared.push({ ...s, status: "pending_review" }); continue; }
        prepared.push({ ...s, status: "auto_applied_unreviewed", target_entity_id: (data as any).id, applied_at: new Date().toISOString() });
        autoApplied++;
      } else if (s.suggestion_type === "add_relationship") {
        const p = s.payload;
        const relationshipDecision = relationshipWriteDecision({
          userId,
          sourceType: p.source_type as "contact" | "self",
          sourceId: p.source_id || null,
          targetType: p.target_type as "contact" | "self",
          targetId: p.target_id || null,
          label: String(p.label || ""),
        });
        if (relationshipDecision.ok === false) { prepared.push({ ...s, status: "removed" }); continue; }
        const relEvidenceQuote = String((p as any).evidence_quote || "").trim();
        if (relEvidenceQuote.length < 10) { prepared.push({ ...s, status: "pending_review" }); continue; }
        const verdict = await adjudicateRelationship({
          db: supabase,
          userId,
          candidate: {
            personA: String(p.contact_name_a || p.person_a || ""),
            personB: String(p.contact_name_b || p.person_b || ""),
            label: relationshipDecision.label,
            inverseLabel: p.inverse_label || null,
            sourceQuote: relEvidenceQuote,
            sourceContext: String(p.source_context || relEvidenceQuote),
          },
        });
        if (verdict.outcome !== "keep") { prepared.push({ ...s, status: "pending_review" }); continue; }
        const { data, error } = await supabase
          .from("contact_relationships")
          .insert({ user_id: userId, source_type: p.source_type, source_id: p.source_id, target_type: p.target_type, target_id: p.target_id, label: relationshipDecision.label, origin: "ai_lexicon", evidence_quote: relEvidenceQuote, evidence_note_id: (p as any).note_id || null })
          .select("id")
          .single();
        if (error || !data) { prepared.push({ ...s, status: "pending_review" }); continue; }
        prepared.push({ ...s, status: "auto_applied_unreviewed", target_entity_id: (data as any).id, applied_at: new Date().toISOString() });
        autoApplied++;
      } else {
        prepared.push({ ...s, status: "pending_review" });
      }
    } catch (err) {
      console.error("[enrich-person] auto-apply error", err);
      prepared.push({ ...s, status: "pending_review" });
    }
  }

  if (prepared.length > 0) {
    const { error: insErr } = await supabase.from("review_queue").insert(prepared);
    if (insErr) console.error("[enrich-person] review_queue insert error", insErr);
  }

  // Phase B mirror (same as process-note): normalize this contact's saved
  // profile so near-duplicate entries — same fact, different phrasing — get
  // merged, or queued for review when uncertain. Runs even when no new facts
  // were extracted, so enrichment doubles as a cleanup trigger for profiles
  // that already contain duplicates. Best-effort: never fail the run.
  let normalizeCreated = 0;
  let normalizeAuto = 0;
  try {
    const res = await createNormalizationSuggestions({
      supabase,
      userId,
      contactId,
      preferences: prefs,
      sourceNoteId: null,
      includeNotesContext: true,
      helpers: {
        filterSuppressedSuggestions,
        prepareSuggestionForInsert: prepareNormalizationSuggestion,
        isSensitiveSuggestion,
        buildSuppressionKey,
      },
    });
    normalizeCreated = res.created;
    normalizeAuto = res.autoApplied;
  } catch (e) {
    console.error("[enrich-person] normalization pass failed:", e);
  }

  return {
    ok: true,
    suggestions_created: prepared.length,
    auto_applied: autoApplied,
    normalization_suggestions: normalizeCreated,
    normalization_auto_applied: normalizeAuto,
  };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "unauthorized" }, 401);

    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: authErr } = await userClient.auth.getUser(authHeader.replace("Bearer ", ""));
    if (authErr || !user) return json({ error: "unauthorized" }, 401);

    const body = await req.json().catch(() => ({} as any));
    const contactId = typeof body?.contact_id === "string" ? body.contact_id : null;
    if (!contactId) return json({ error: "contact_id required" }, 400);

    // @ts-expect-error EdgeRuntime is a Supabase global
    EdgeRuntime.waitUntil(
      run(user.id, contactId).then((r) => console.log("[enrich-person] result", r)).catch((err) => {
        if (err?.message === "INSUFFICIENT_CREDITS") return;
        console.error("[enrich-person] error", err);
      }),
    );

    return json({ ok: true, started: true, message: "Person enrichment running in background." });
  } catch (err) {
    console.error("enrich-person-from-lexicon error:", err);
    return json({ error: err instanceof Error ? err.message : "Internal error" }, 500);
  }
});
