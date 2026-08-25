import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { z } from "npm:zod@3.23.8";
import {
  applyNormalization,
  createNormalizationSuggestions,
  planSubjectNormalization,
  resolveCategoryId,
  rollbackNormalization,
  splitListTokens,
  type NormalizationPayload,
} from "../_shared/profile-normalization.ts";
import { gateStoredValue } from "../_shared/profile-fact-gate.ts";
import {
  canonicalProfileLabel,
  correctProfileCategory,
  isBlockedProfileLabel,
  isListValuedLabel,
} from "../_shared/profile-canonical-schema.ts";
import { isSkillLabel, routeSkillValue } from "../_shared/profile-skill-guard.ts";
import { guardNameValue, isNameLabel } from "../_shared/profile-name-guard.ts";

import {
  buildProfileTokenIndex,
  dedupIncomingProfileValue,
} from "../_shared/profile-dedup.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type SubjectRunResult = {
  subject: string;
  input_hash: string;
  completed_hash?: string;
  status: "completed" | "failed" | "skipped";
  created: number;
  autoApplied: number;
  planned: number;
  applied: number;
  review: number;
  skipped: number;
  error?: string;
};

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

const SENSITIVITY_THRESHOLDS: Record<string, number> = { conservative: 0.85, balanced: 0.7, exploratory: 0.55 };
const AUTO_APPLY_THRESHOLDS: Record<string, Record<string, number>> = {
  add_profile_entry: { conservative: 0.78, balanced: 0.65, exploratory: 0.5 },
  add_relationship: { conservative: 0.80, balanced: 0.7, exploratory: 0.55 },
  add_moment: { conservative: 0.85, balanced: 0.75, exploratory: 0.6 },
  normalize_profile_entry: { conservative: 0.92, balanced: 0.85, exploratory: 0.75 },
};

const ProfileEntryInputSchema = z.object({
  contact_id: z.string().uuid().nullable().optional(),
  category_id: z.string().uuid().nullable().optional(),
  category_slug: z.string().trim().min(1).max(80).optional(),
  label: z.string().trim().min(1).max(160),
  value: z.string().trim().min(1).max(2000),
  sort_order: z.coerce.number().int().min(0).max(10_000).optional(),
  linked_note_id: z.string().uuid().nullable().optional(),
  is_pinned: z.boolean().optional(),
  // Provenance is mandatory downstream; a request that does not say otherwise
  // is a human editing their own profile through the UI.
  origin: z.enum(["user_manual","ai_note","ai_moment","ai_lexicon","review_queue","import","mcp","api","normalizer"]).optional(),
  evidence_quote: z.string().trim().max(2000).optional(),
});

const BulkProfileReviewSchema = z.object({
  decision: z.enum(["keep"]),
  review_ids: z.array(z.string().uuid()).min(1).max(500),
});

function normalizeComparable(value: unknown): string {
  return String(value || "").trim().toLowerCase().replace(/\s+/g, " ");
}

function subjectFilter(query: any, contactId: string | null) {
  return contactId ? query.eq("contact_id", contactId) : query.is("contact_id", null);
}

async function resolveCategoryForWrite(
  db: any,
  userId: string,
  contactId: string | null,
  input: { category_id?: string | null; category_slug?: string },
  correctedSlug: string,
): Promise<{ id: string; slug: string } | null> {
  if (input.category_id) {
    const { data } = await db
      .from("profile_categories")
      .select("id, slug")
      .eq("id", input.category_id)
      .eq("user_id", userId)
      .maybeSingle();
    if (data?.id && data.slug === correctedSlug) return { id: data.id, slug: data.slug };
  }

  const base = db
    .from("profile_categories")
    .select("id, slug")
    .eq("user_id", userId)
    .eq("slug", correctedSlug);
  const { data: existing } = contactId
    ? await base.eq("contact_id", contactId).maybeSingle()
    : await base.is("contact_id", null).maybeSingle();
  if (existing?.id) return { id: existing.id, slug: existing.slug };

  const { data: created, error } = await db
    .from("profile_categories")
    .insert({
      user_id: userId,
      contact_id: contactId,
      slug: correctedSlug,
      name: correctedSlug.charAt(0).toUpperCase() + correctedSlug.slice(1),
      icon: "folder",
      is_default: false,
      sort_order: 99,
      visibility_scope: "all",
    } as any)
    .select("id, slug")
    .maybeSingle();

  if (created?.id) return { id: created.id, slug: created.slug };
  if (error && (error as any).code !== "23505") throw error;

  const retryBase = db
    .from("profile_categories")
    .select("id, slug")
    .eq("user_id", userId)
    .eq("slug", correctedSlug);
  const { data: raced } = contactId
    ? await retryBase.eq("contact_id", contactId).maybeSingle()
    : await retryBase.is("contact_id", null).maybeSingle();
  return raced?.id ? { id: raced.id, slug: raced.slug } : null;
}

async function enqueueSubjectNormalization(db: any, userId: string, contactId: string | null, reason: string) {
  const { error } = await db.rpc("enqueue_profile_normalization_job", {
    p_user_id: userId,
    p_contact_id: contactId,
    p_reason: reason,
  });
  if (error) console.error("[normalize-profile] enqueue failed:", error);
}

function normalizeIncomingFact(categorySlug: string, label: string, value: string) {
  let nextSlug = categorySlug;
  let nextLabel = label.trim();
  let nextValue = value.trim();
  const booleanValues = new Set(["true", "yes", "y", "x", "✓", "✔"]);
  const lowerValue = nextValue.toLowerCase();
  const diagnosisMatch = nextLabel.match(/^diagnosis\s*:\s*(.+)$/i);

  if (nextSlug === "health" && diagnosisMatch?.[1]?.trim()) {
    nextLabel = "Health conditions";
    nextValue = diagnosisMatch[1].trim();
  } else if (nextSlug === "health" && booleanValues.has(lowerValue) && nextLabel.length <= 60 && !/[:{}]/.test(nextLabel)) {
    nextValue = nextLabel;
    nextLabel = "Health conditions";
  }

  nextSlug = correctProfileCategory(nextLabel, nextSlug);
  nextLabel = canonicalProfileLabel(nextSlug, nextLabel);
  nextSlug = correctProfileCategory(nextLabel, nextSlug);

  // Name guard — same rules as the extractor, so a normalization pass can
  // never re-introduce a handle or noise value as a nickname.
  if (isNameLabel(nextLabel)) {
    const members = nextValue.split(/\s*,\s*/).map((m) => m.trim()).filter(Boolean);
    const kept: string[] = [];
    const handles: string[] = [];
    for (const member of members) {
      const decision = guardNameValue({ label: nextLabel, value: member });
      if (decision.action === "drop") continue;
      if (decision.action === "relabel") handles.push(decision.value);
      else kept.push(decision.value);
    }
    if (kept.length > 0) {
      nextValue = kept.join(", ");
    } else if (handles.length > 0) {
      nextSlug = "communication";
      nextLabel = "Online handle";
      nextValue = handles.join(", ");
    } else {
      nextValue = "";
    }
  }

  return { categorySlug: nextSlug, label: nextLabel, value: nextValue };
}

async function writeProfileEntrySafely(args: {
  db: any;
  userId: string;
  input: z.infer<typeof ProfileEntryInputSchema>;
  reviewId?: string | null;
}): Promise<{ ok: boolean; outcome: "inserted" | "already_exists" | "merged_list" | "rejected_duplicate"; entryId?: string | null; reason?: string }> {
  const { db, userId, input, reviewId = null } = args;
  const contactId = input.contact_id ?? null;

  if (contactId) {
    const { data: contact } = await db.from("contacts").select("id").eq("id", contactId).eq("user_id", userId).maybeSingle();
    if (!contact?.id) return { ok: false, outcome: "rejected_duplicate", reason: "contact_not_found" };
  }

  let categorySlug = input.category_slug || "preferences";
  if (!input.category_slug && input.category_id) {
    const { data: cat } = await db
      .from("profile_categories")
      .select("slug")
      .eq("id", input.category_id)
      .eq("user_id", userId)
      .maybeSingle();
    if (cat?.slug) categorySlug = cat.slug;
  }

  const fact = normalizeIncomingFact(categorySlug, input.label, input.value);

  // Name guard may have emptied the value (handle/noise only).
  if (!fact.value.trim()) {
    return { ok: false, outcome: "rejected_duplicate", reason: "empty_after_guards" };
  }

  // Hard gate: relationship edges, purchase/event facts and the retired
  // "Current address" blob must never reach profile_entries — no matter which
  // path (LLM, review queue, manual add) tried to write them.
  if (isBlockedProfileLabel(fact.label)) {
    return { ok: false, outcome: "rejected_duplicate", reason: "blocked_label" };
  }

  // Skill guard (last line of defence): strip members that are person names,
  // products, languages or bare topics before anything lands under "Skill".
  if (isSkillLabel(fact.label)) {
    const routes = routeSkillValue(fact.value);
    const kept = routes.filter((r) => r.action === "keep").map((r) => r.member);
    if (kept.length === 0) {
      return { ok: false, outcome: "rejected_duplicate", reason: "not_a_skill" };
    }
    fact.value = kept.join(", ");
  }


  const category = await resolveCategoryForWrite(db, userId, contactId, input, fact.categorySlug);
  if (!category?.id) return { ok: false, outcome: "rejected_duplicate", reason: "category_unresolved" };

  const { data: entries } = await subjectFilter(
    db.from("profile_entries").select("id, category_id, contact_id, label, value, sort_order, linked_note_id").eq("user_id", userId),
    contactId,
  );
  const { data: categories } = await subjectFilter(
    db.from("profile_categories").select("id, slug").eq("user_id", userId),
    contactId,
  );
  const slugById = new Map(((categories || []) as any[]).map((c) => [c.id, c.slug]));

  const exact = ((entries || []) as any[]).find((entry) =>
    entry.category_id === category.id &&
    normalizeComparable(entry.label) === normalizeComparable(fact.label) &&
    normalizeComparable(entry.value) === normalizeComparable(fact.value)
  );
  if (exact?.id) return { ok: true, outcome: "already_exists", entryId: exact.id };

  const queueQuery = db
    .from("review_queue")
    .select("id, payload, status")
    .eq("user_id", userId)
    .eq("suggestion_type", "add_profile_entry")
    .in("status", ["pending", "pending_review", "auto_applied_unreviewed"]);
  const { data: queueRows } = reviewId ? await queueQuery.neq("id", reviewId) : await queueQuery;

  const dedupIndex = buildProfileTokenIndex(
    (entries || []) as any[],
    (queueRows || []).map((q: any) => ({
      contact_id: q.payload?.contact_id ?? null,
      label: String(q.payload?.label || ""),
      value: String(q.payload?.value || ""),
    })),
  );
  const dedup = dedupIncomingProfileValue({ contactId, label: fact.label, value: fact.value, index: dedupIndex });
  if (dedup.action === "skip") {
    const sameLabel = ((entries || []) as any[]).find((entry) => {
      const currentSlug = slugById.get(entry.category_id) || categorySlug;
      const corrected = correctProfileCategory(entry.label, currentSlug);
      const currentLabel = canonicalProfileLabel(corrected, entry.label);
      return normalizeComparable(currentLabel) === normalizeComparable(fact.label);
    });
    return { ok: true, outcome: "already_exists", entryId: sameLabel?.id ?? exact?.id ?? null, reason: dedup.reason };
  }

  if (isListValuedLabel(fact.label)) {
    const existingList = ((entries || []) as any[]).find((entry) => {
      const currentSlug = slugById.get(entry.category_id) || categorySlug;
      const corrected = correctProfileCategory(entry.label, currentSlug);
      const currentLabel = canonicalProfileLabel(corrected, entry.label);
      return normalizeComparable(currentLabel) === normalizeComparable(fact.label);
    });
    if (existingList?.id) {
      const seen = new Set<string>();
      const union: string[] = [];
      for (const tok of [...splitListTokens(fact.label, existingList.value), ...splitListTokens(fact.label, dedup.value)]) {
        if (seen.has(tok.key)) continue;
        seen.add(tok.key);
        union.push(tok.display);
      }
      const nextValue = union.join(", ");
      if (normalizeComparable(existingList.value) === normalizeComparable(nextValue) && existingList.category_id === category.id && existingList.label === fact.label) {
        return { ok: true, outcome: "already_exists", entryId: existingList.id };
      }
      const { data, error } = await db
        .from("profile_entries")
        .update({ category_id: category.id, label: fact.label, value: nextValue })
        .eq("id", existingList.id)
        .eq("user_id", userId)
        .select("id")
        .maybeSingle();
      if (error) throw error;
      await enqueueSubjectNormalization(db, userId, contactId, "profile_entry_merged_list");
      return { ok: true, outcome: "merged_list", entryId: data?.id ?? existingList.id };
    }
  }

  const { data: inserted, error } = await db
    .from("profile_entries")
    .insert({
      user_id: userId,
      contact_id: contactId,
      category_id: category.id,
      label: fact.label,
      value: dedup.value,
      sort_order: input.sort_order ?? 0,
      origin: input.origin ?? "user_manual",
      evidence_quote: input.evidence_quote ?? null,
      linked_note_id: input.linked_note_id ?? null,
      is_pinned: input.is_pinned ?? false,
    } as any)
    .select("id")
    .maybeSingle();

  if (error) {
    if ((error as any).code === "23505") return { ok: true, outcome: "already_exists", entryId: null, reason: "unique_guard" };
    throw error;
  }

  // A BEFORE INSERT trigger (dedup / quality / duplicate-fact guard) can return
  // NULL, which suppresses the row *without* raising an error. Postgrest then
  // returns no row. Never report that as "inserted": re-read the subject and
  // either resolve it to the entry that absorbed the fact, or fail loudly so
  // the caller (and the user's toast) learns the fact was not stored.
  if (!inserted?.id) {
    const { data: after } = await subjectFilter(
      db.from("profile_entries").select("id, category_id, label, value").eq("user_id", userId),
      contactId,
    );
    const rows = (after || []) as any[];
    const absorbing =
      rows.find(
        (entry) =>
          normalizeComparable(entry.label) === normalizeComparable(fact.label) &&
          normalizeComparable(entry.value) === normalizeComparable(dedup.value),
      ) ||
      rows.find(
        (entry) =>
          normalizeComparable(entry.label) === normalizeComparable(fact.label) &&
          normalizeComparable(entry.value).includes(normalizeComparable(dedup.value)),
      );
    if (absorbing?.id) {
      await enqueueSubjectNormalization(db, userId, contactId, "profile_entry_absorbed");
      return { ok: true, outcome: "already_exists", entryId: absorbing.id, reason: "absorbed" };
    }
    console.error("[normalize-profile] insert suppressed by guard", {
      userId,
      contactId,
      label: fact.label,
      value: dedup.value,
    });
    return {
      ok: false,
      outcome: "rejected_duplicate",
      entryId: null,
      reason: "suppressed_by_guard",
    };
  }

  await enqueueSubjectNormalization(db, userId, contactId, "profile_entry_inserted");
  return { ok: true, outcome: "inserted", entryId: inserted?.id ?? null };
}


async function acceptProfileEntryReview(db: any, userId: string, reviewId: string) {
  const { data: row, error } = await db
    .from("review_queue")
    .select("id, user_id, suggestion_type, payload, source_note_id, status")
    .eq("id", reviewId)
    .maybeSingle();
  if (error || !row) return { ok: false, outcome: "rejected_duplicate", reason: "not_found" };
  if (row.user_id !== userId) return { ok: false, outcome: "rejected_duplicate", reason: "forbidden" };
  if (row.suggestion_type !== "add_profile_entry") return { ok: false, outcome: "rejected_duplicate", reason: "wrong_suggestion_type" };
  const payload = row.payload || {};
  const parsed = ProfileEntryInputSchema.safeParse({
    contact_id: payload.contact_id ?? null,
    category_id: payload.category_id ?? null,
    category_slug: payload.category_slug,
    label: payload.label,
    value: payload.value,
    linked_note_id: row.source_note_id ?? null,
    origin: "review_queue",
    evidence_quote: String(payload.evidence_quote || "").trim() || undefined,
  });
  if (!parsed.success) return { ok: false, outcome: "rejected_duplicate", reason: "invalid_payload" };

  const result = await writeProfileEntrySafely({ db, userId, input: parsed.data, reviewId });
  if (result.ok) {
    await db
      .from("review_queue")
      .update({
        status: "kept",
        target_entity_type: "profile_entry",
        target_entity_id: result.entryId ?? null,
        applied_at: new Date().toISOString(),
        reviewed_at: new Date().toISOString(),
      })
      .eq("id", reviewId);
  }
  return result;
}
function thresholdFor(suggestionType: string, sensitivity: string): number {
  const perType = AUTO_APPLY_THRESHOLDS[suggestionType];
  if (perType && perType[sensitivity] !== undefined) return perType[sensitivity];
  return SENSITIVITY_THRESHOLDS[sensitivity] ?? SENSITIVITY_THRESHOLDS.balanced;
}

async function filterSuppressedSuggestions(db: any, userId: string, suggestions: any[]) {
  if (suggestions.length === 0) return suggestions;
  const keys = suggestions.map((s) => s.suppression_key).filter(Boolean);
  if (keys.length === 0) return suggestions;
  const { data } = await db
    .from("ai_suggestion_suppressions")
    .select("suppression_key")
    .eq("user_id", userId)
    .in("suppression_key", keys);
  const blocked = new Set(((data || []) as any[]).map((r) => r.suppression_key));
  return suggestions.filter((s) => !s.suppression_key || !blocked.has(s.suppression_key));
}

async function getSuggestionPreferences(db: any, userId: string) {
  const { data } = await db
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

function makePrepareSuggestion(db: any) {
  return async (suggestion: any, preferences: { mode: string; sensitivity: string; autoAddSensitive: boolean }) => {
    const threshold = thresholdFor(suggestion.suggestion_type, preferences.sensitivity);
    const confidence = suggestion.confidence_score ?? 0;
    // Normalization does not introduce new sensitive facts; it merges/relabels
    // facts the user already has. High-confidence cleanup should therefore run
    // silently even for health/relationship fields, instead of leaving janitor
    // work in Review Queue. Low-confidence conflict groups still require review.
    const isHighConfidenceNormalization = suggestion.suggestion_type === "normalize_profile_entry" && confidence >= 0.95;
    const canAutoApply = isHighConfidenceNormalization || (
      preferences.mode === "auto" &&
      confidence >= threshold &&
      (!suggestion.is_sensitive || preferences.autoAddSensitive)
    );
    if (!canAutoApply) return { ...suggestion, status: "pending_review" };

    if (suggestion.suggestion_type === "normalize_profile_entry") {
      try {
        const result = await applyNormalization(db, suggestion.payload as NormalizationPayload);
        if (result.ok && result.entryId) {
          return { ...suggestion, status: "auto_applied_unreviewed", target_entity_id: result.entryId, applied_at: new Date().toISOString() };
        }
      } catch (e) {
        console.error("[normalize-profile] auto-apply failed:", e);
      }
    }
    return { ...suggestion, status: "pending_review" };
  };
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function getProfileInputHash(db: any, userId: string, contactId: string | null): Promise<string> {
  let query = db
    .from("profile_entries")
    .select("id, category_id, label, value, sort_order, linked_note_id, updated_at, created_at")
    .eq("user_id", userId)
    .order("id", { ascending: true });
  query = contactId ? query.eq("contact_id", contactId) : query.is("contact_id", null);
  const { data, error } = await query;
  if (error) throw error;
  return sha256Hex(JSON.stringify(data || []));
}

async function readRunState(db: any, userId: string, contactId: string | null) {
  const subjectType = contactId ? "contact" : "owner";
  const base = db
    .from("profile_normalization_runs")
    .select("id, input_hash, status, completed_at")
    .eq("user_id", userId)
    .eq("subject_type", subjectType)
    .limit(1);
  const { data, error } = contactId
    ? await base.eq("contact_id", contactId).maybeSingle()
    : await base.is("contact_id", null).maybeSingle();
  if (error) throw error;
  return data;
}

async function writeRunState(db: any, userId: string, contactId: string | null, values: Record<string, unknown>) {
  const subjectType = contactId ? "contact" : "owner";
  const existing = await readRunState(db, userId, contactId);
  const payload = {
    user_id: userId,
    contact_id: contactId,
    subject_type: subjectType,
    ...values,
  };
  if (existing?.id) {
    const { error } = await db.from("profile_normalization_runs").update(payload).eq("id", existing.id);
    if (error) throw error;
    return existing.id;
  }
  const { data, error } = await db.from("profile_normalization_runs").insert(payload).select("id").single();
  if (error) throw error;
  return data?.id;
}

type ExplodeStats = { examined: number; exploded: number; rerouted: number; unfiled: number; skipped: number };

/**
 * Re-file stored profile rows through the admission gate so every row holds
 * exactly one fact under the label its TYPE belongs to. Shared by the manual
 * "Tidy up profile" action and the nightly sweep.
 */
async function explodeBags(
  db: any,
  userId: string,
  subjects: Array<string | null>,
  stats: ExplodeStats,
): Promise<ExplodeStats> {
  for (const subj of subjects) {
    const q = db
      .from("profile_entries")
      .select("id, category_id, label, value, origin, evidence_quote, linked_note_id, sort_order")
      .eq("user_id", userId)
      .limit(2000);
    const { data: rows } = subj ? await q.eq("contact_id", subj) : await q.is("contact_id", null);

    const catIds = [...new Set((rows || []).map((r: any) => r.category_id).filter(Boolean))];
    const slugById = new Map<string, string>();
    if (catIds.length > 0) {
      const { data: cats } = await db.from("profile_categories").select("id, slug").in("id", catIds);
      for (const c of (cats || []) as any[]) slugById.set(c.id, c.slug);
    }

    for (const row of (rows || []) as any[]) {
      stats.examined++;
      const slug = slugById.get(row.category_id) || "other";
      const facts = gateStoredValue({ label: row.label, categorySlug: slug, value: row.value });

      const unchanged =
        facts.length === 1 &&
        facts[0].accepted &&
        facts[0].value === String(row.value || "").trim() &&
        facts[0].label === row.label;
      if (unchanged) { stats.skipped++; continue; }
      if (facts.length === 1 && !facts[0].accepted && facts[0].reason === "not_atomic") {
        stats.skipped++;
        continue;
      }

      const writes: Array<{ label: string; slug: string; value: string }> = [];
      let hasUnrepresentable = false;
      for (const f of facts) {
        if (f.accepted) {
          if (f.reason === "rerouted_by_type") stats.rerouted++;
          writes.push({ label: f.label, slug: f.categorySlug, value: f.value });
        } else if (f.reason?.startsWith("type_mismatch")) {
          stats.unfiled++;
          writes.push({ label: "Unfiled note", slug, value: f.value });
        } else {
          // not_atomic / empty / any other non-routable segment cannot be
          // re-filed. The source row is deleted below before the writes are
          // re-inserted, so if even one segment lands here, deleting the row
          // would permanently lose that content — leave the whole row intact.
          hasUnrepresentable = true;
        }
      }
      if (hasUnrepresentable) { stats.skipped++; continue; }
      if (writes.length === 0) { stats.skipped++; continue; }

      await db.from("profile_entries").delete().eq("id", row.id).eq("user_id", userId);
      for (const w of writes) {
        const categoryId =
          w.slug === slug ? row.category_id : await resolveCategoryId(db, userId, subj, w.slug);
        if (!categoryId) continue;
        const { error: insErr } = await db.from("profile_entries").insert({
          user_id: userId,
          contact_id: subj,
          category_id: categoryId,
          label: w.label,
          value: w.value,
          origin: row.origin,
          evidence_quote: row.evidence_quote,
          linked_note_id: row.linked_note_id,
          sort_order: row.sort_order ?? 0,
        } as any);
        // A blocked insert means the fact already exists elsewhere in a
        // cleaner form — the dedup guard is the authority, not this job.
        if (!insErr) stats.exploded++;
      }
    }
  }
  return stats;
}

serve(async (req) => {

  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;

    const db = createClient(SUPABASE_URL, SERVICE_ROLE);

    const body = await req.json().catch(() => ({}));
    const action = String(body?.action || "");

    // Nightly sweep: pg_cron presents a shared key (never the service role key)
    // and re-files bags for every user's own profile and contacts, so profiles
    // cannot silently drift back into comma text walls.
    const cronKey = Deno.env.get("PROFILE_LINT_CRON_KEY") || "";
    const presentedCron = req.headers.get("x-cron-key") || "";
    if (cronKey && presentedCron === cronKey) {
      if (action !== "explode_bags") return json({ error: "cron supports explode_bags only" }, 400);
      const { data: owners } = await db
        .from("profile_entries")
        .select("user_id")
        .limit(5000);
      const userIds = [...new Set((owners || []).map((r: any) => r.user_id))];
      const stats: ExplodeStats = { examined: 0, exploded: 0, rerouted: 0, unfiled: 0, skipped: 0 };
      for (const uid of userIds) {
        const subjects: Array<string | null> = [null];
        const { data: contacts } = await db
          .from("contacts").select("id").eq("user_id", uid).is("merged_into", null).limit(500);
        for (const c of (contacts || []) as any[]) subjects.push(c.id);
        await explodeBags(db, uid, subjects, stats);
      }
      return json({ ok: true, users: userIds.length, ...stats });
    }

    if (!authHeader) return json({ error: "Unauthorized" }, 401);



    // Trusted server-to-server calls (e.g. review-queue-bulk) authenticate with
    // the service-role key, which is NOT a user JWT — auth.getUser() would fail
    // on it. In that case the acting user is taken from the request body.
    // Every downstream check still compares row.user_id against this value.
    const bearer = authHeader.replace(/^Bearer\s+/i, "").trim();
    const isServiceCall = !!SERVICE_ROLE && bearer === SERVICE_ROLE;

    let userId: string;
    if (isServiceCall) {
      const claimed = String(body?.user_id || "");
      if (!z.string().uuid().safeParse(claimed).success) {
        return json({ error: "user_id required for service-role calls" }, 400);
      }
      userId = claimed;
    } else {
      const anonClient = createClient(SUPABASE_URL, ANON);
      const { data: { user }, error: authErr } = await anonClient.auth.getUser(bearer);
      if (authErr || !user) return json({ error: "Unauthorized" }, 401);
      userId = user.id;
    }

    const prepareSuggestionForInsert = makePrepareSuggestion(db);
    const helpers = { filterSuppressedSuggestions: (uid: string, s: any[]) => filterSuppressedSuggestions(db, uid, s), prepareSuggestionForInsert, isSensitiveSuggestion, buildSuppressionKey };

    // Legacy repair: rows written before the atomizer trigger existed are
    // "bags" — several facts joined into one string, often under a label they
    // don't fit ("Full name: Yumei, hi14miau@gmail.com, Occupation: …").
    // This re-files every stored value through the admission gate: atomic
    // facts are re-inserted under the label their TYPE says they belong to,
    // and prose stranded in a typed field moves to a neutral "Unfiled note"
    // row in the same category instead of being silently dropped.
    if (action === "explode_bags") {
      const scope = String(body?.scope || "owner");
      const subjects: Array<string | null> = [];
      if (scope === "owner") {
        subjects.push(null);
      } else if (scope === "contact") {
        const contactId = String(body?.contact_id || "");
        if (!contactId) return json({ error: "contact_id required" }, 400);
        const { data: c } = await db.from("contacts").select("id").eq("id", contactId).eq("user_id", userId).maybeSingle();
        if (!c) return json({ error: "contact not found" }, 404);
        subjects.push(contactId);
      } else if (scope === "all_contacts") {
        subjects.push(null);
        const { data: contacts } = await db
          .from("contacts").select("id").eq("user_id", userId).is("merged_into", null).limit(500);
        for (const c of (contacts || []) as any[]) subjects.push(c.id);
      } else {
        return json({ error: "invalid scope" }, 400);
      }

      const stats = { examined: 0, exploded: 0, rerouted: 0, unfiled: 0, skipped: 0 };

      await explodeBags(db, userId, subjects, stats);

      return json({ ok: true, ...stats });
    }


    if (action === "plan") {
      const scope = String(body?.scope || "owner");
      const contactId = scope === "owner" ? null : String(body?.contact_id || "");
      if (scope === "contact" && !contactId) return json({ error: "contact_id required" }, 400);
      // Authorize: caller must own the contact (RLS check).
      if (contactId) {
        const { data: c } = await db.from("contacts").select("id").eq("id", contactId).eq("user_id", userId).maybeSingle();
        if (!c) return json({ error: "contact not found" }, 404);
      }
      const includeNotesContext = body?.includeNotesContext === false ? false : true;
      const groups = await planSubjectNormalization({ supabase: db, userId, contactId, includeNotesContext });
      return json({ groups });
    }

    if (action === "backfill") {
      const scope = String(body?.scope || "owner");
      const preferences = await getSuggestionPreferences(db, userId);
      const force = body?.force === true;
      const includeNotesContext = body?.includeNotesContext === false ? false : true;

      const subjects: Array<string | null> = [];
      if (scope === "owner") {
        subjects.push(null);
      } else if (scope === "contact") {
        const contactId = String(body?.contact_id || "");
        if (!contactId) return json({ error: "contact_id required" }, 400);
        const { data: c } = await db.from("contacts").select("id").eq("id", contactId).eq("user_id", userId).maybeSingle();
        if (!c) return json({ error: "contact not found" }, 404);
        subjects.push(contactId);
      } else if (scope === "all_contacts") {
        subjects.push(null);
        const { data: contacts } = await db
          .from("contacts")
          .select("id")
          .eq("user_id", userId)
          .is("merged_into", null)
          .limit(500);
        for (const c of (contacts || []) as any[]) subjects.push(c.id);
      } else {
        return json({ error: "invalid scope" }, 400);
      }

      const runOne = async (subj: string | null): Promise<SubjectRunResult> => {
        const subjectLabel = subj ?? "owner";
        const inputHash = await getProfileInputHash(db, userId, subj);
        const state = await readRunState(db, userId, subj);
        if (!force && state?.status === "completed" && state.input_hash === inputHash) {
          return {
            subject: subjectLabel,
            input_hash: inputHash,
            completed_hash: inputHash,
            status: "skipped",
            created: 0,
            autoApplied: 0,
            planned: 0,
            applied: 0,
            review: 0,
            skipped: 1,
          };
        }

        await writeRunState(db, userId, subj, {
          input_hash: inputHash,
          status: "running",
          planned_count: 0,
          applied_count: 0,
          review_count: 0,
          skipped_count: 0,
          error_message: null,
          started_at: new Date().toISOString(),
          completed_at: null,
        });

        try {
          const aggregate = { created: 0, autoApplied: 0, planned: 0, applied: 0, review: 0, skipped: 0 };
          for (let pass = 0; pass < 3; pass += 1) {
            const r = await createNormalizationSuggestions({
              supabase: db,
              userId,
              contactId: subj,
              preferences,
              sourceNoteId: null,
              includeNotesContext,
              helpers,
            });
            aggregate.created += r.created;
            aggregate.autoApplied += r.autoApplied;
            aggregate.planned += r.planned;
            aggregate.applied += r.applied;
            aggregate.review += r.review;
            aggregate.skipped += r.skipped;
            // Direct deterministic passes mutate rows. Re-plan immediately so
            // groups that were intentionally non-overlapping in pass N can be
            // folded in pass N+1 before we record this input as complete.
            if (r.applied === 0 || r.planned === 0) break;
          }
          const completedHash = await getProfileInputHash(db, userId, subj);
          await writeRunState(db, userId, subj, {
            input_hash: completedHash,
            status: "completed",
            planned_count: aggregate.planned,
            applied_count: aggregate.applied,
            review_count: aggregate.review,
            skipped_count: aggregate.skipped,
            error_message: null,
            completed_at: new Date().toISOString(),
          });
          return { subject: subjectLabel, input_hash: inputHash, completed_hash: completedHash, status: "completed", ...aggregate };
        } catch (e) {
          const message = String(e);
          await writeRunState(db, userId, subj, {
            input_hash: inputHash,
            status: "failed",
            error_message: message,
            completed_at: new Date().toISOString(),
          });
          console.error(`[normalize-profile] backfill subject=${subj}`, e);
          return {
            subject: subjectLabel,
            input_hash: inputHash,
            status: "failed",
            created: 0,
            autoApplied: 0,
            planned: 0,
            applied: 0,
            review: 0,
            skipped: 0,
            error: message,
          };
        }
      };

      const runAll = async () => {
        const perSubject: SubjectRunResult[] = [];
        for (const subj of subjects) perSubject.push(await runOne(subj));
        const totals = perSubject.reduce(
          (acc, r) => ({
            created: acc.created + r.created,
            autoApplied: acc.autoApplied + r.autoApplied,
            planned: acc.planned + r.planned,
            applied: acc.applied + r.applied,
            review: acc.review + r.review,
            skipped: acc.skipped + r.skipped,
          }),
          { created: 0, autoApplied: 0, planned: 0, applied: 0, review: 0, skipped: 0 },
        );
        console.log(`[normalize-profile] backfill done: ${JSON.stringify({ scope, subjectCount: subjects.length, ...totals })}`);
        return { perSubject, totals };
      };

      // Always run backfills in the background: a synchronous pass can exceed
      // the 150s idle timeout and return a 504 to the client.
      try {
        // @ts-expect-error - EdgeRuntime is a Supabase Edge global
        EdgeRuntime.waitUntil(runAll());
      } catch {
        void runAll();
      }
      return json({ ok: true, started: true, scope, subjectCount: subjects.length }, 202);

    }

    if (action === "write_profile_entry") {
      const parsed = ProfileEntryInputSchema.safeParse(body?.entry || body);
      if (!parsed.success) return json({ error: parsed.error.flatten().fieldErrors }, 400);
      const result = await writeProfileEntrySafely({ db, userId, input: parsed.data });
      if (!result.ok) return json({ ok: false, reason: result.reason || result.outcome }, 409);
      return json({ ok: true, ...result });
    }

    if (action === "accept_profile_entry") {
      const reviewId = String(body?.review_id || "");
      if (!reviewId) return json({ error: "review_id required" }, 400);
      const result = await acceptProfileEntryReview(db, userId, reviewId);
      if (!result.ok) return json({ ok: false, reason: result.reason || result.outcome }, 409);
      return json({ ok: true, ...result });
    }

    if (action === "bulk_profile_reviews") {
      const parsed = BulkProfileReviewSchema.safeParse(body);
      if (!parsed.success) return json({ error: parsed.error.flatten().fieldErrors }, 400);
      const summary = { processed: 0, inserted: 0, already_exists: 0, merged_list: 0, rejected_duplicate: 0, failed: 0 };
      for (const reviewId of parsed.data.review_ids) {
        try {
          const result = await acceptProfileEntryReview(db, userId, reviewId);
          summary.processed += 1;
          if (result.ok && result.outcome === "inserted") summary.inserted += 1;
          else if (result.ok && result.outcome === "already_exists") summary.already_exists += 1;
          else if (result.ok && result.outcome === "merged_list") summary.merged_list += 1;
          else summary.rejected_duplicate += 1;
        } catch (e) {
          summary.processed += 1;
          summary.failed += 1;
          console.error("[normalize-profile] bulk profile review failed", reviewId, e);
        }
      }
      return json({ ok: true, summary });
    }

    if (action === "apply") {
      const reviewId = String(body?.review_id || "");
      if (!reviewId) return json({ error: "review_id required" }, 400);
      const { data: row, error } = await db
        .from("review_queue")
        .select("id, user_id, suggestion_type, payload, status")
        .eq("id", reviewId)
        .maybeSingle();
      if (error || !row) return json({ error: "not found" }, 404);
      if (row.user_id !== userId) return json({ error: "forbidden" }, 403);
      if (row.suggestion_type !== "normalize_profile_entry") return json({ error: "wrong suggestion_type" }, 400);

      const result = await applyNormalization(db, row.payload as NormalizationPayload);
      if (!result.ok) {
        // A suggestion may never get permanently stuck in the queue. Only a
        // genuinely transient failure (an unexpected exception) keeps the row
        // pending; every other outcome would fail identically on every retry,
        // so the row is resolved server-side with the reason recorded.
        const reason = result.reason || "unknown";
        if (reason !== "exception") {
          await db
            .from("review_queue")
            .update({
              status: "removed",
              reviewed_at: new Date().toISOString(),
              payload: { ...(row.payload as Record<string, unknown>), apply_failure_reason: reason },
            })
            .eq("id", reviewId);
          // Not an error: the row was resolved server-side. Return 200 so the
          // client (and the platform error reporter) don't treat it as a failure.
          return json({ ok: false, reason, resolved: true }, 200);
        }
        return json({ ok: false, reason }, 409);


      }

      await db
        .from("review_queue")
        .update({ status: "kept", target_entity_id: result.entryId, applied_at: new Date().toISOString() })
        .eq("id", reviewId);

      return json({ ok: true, entry_id: result.entryId });
    }

    if (action === "rollback") {
      const reviewId = String(body?.review_id || "");
      if (!reviewId) return json({ error: "review_id required" }, 400);
      const { data: row, error } = await db
        .from("review_queue")
        .select("id, user_id, suggestion_type, payload, target_entity_id, status")
        .eq("id", reviewId)
        .maybeSingle();
      if (error || !row) return json({ error: "not found" }, 404);
      if (row.user_id !== userId) return json({ error: "forbidden" }, 403);
      if (row.suggestion_type !== "normalize_profile_entry") return json({ error: "wrong suggestion_type" }, 400);

      await rollbackNormalization(db, row.payload as NormalizationPayload, row.target_entity_id);
      await db
        .from("review_queue")
        .update({ status: "removed" })
        .eq("id", reviewId);
      return json({ ok: true });
    }

    return json({ error: "unknown action" }, 400);
  } catch (err) {
    console.error("[normalize-profile] handler error:", err);
    return json({ error: String(err) }, 500);
  }
});
