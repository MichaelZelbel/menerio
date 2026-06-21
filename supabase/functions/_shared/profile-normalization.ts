// Phase B — Profile Normalizer.
// Plans + applies destructive-but-reversible cleanups on saved profile_entries
// for one subject (owner or contact). All apply operations snapshot the prior
// rows into the review_queue payload so they can be rolled back exactly.

import { runChat } from "./llm-router.ts";
import {
  PROFILE_CANONICAL_SCHEMA,
  CANONICAL_LABELS_FOR_PROMPT,
  canonicalProfileLabel,
  correctProfileCategory,
} from "./profile-canonical-schema.ts";

const PROFILE_CATEGORY_SLUGS = [
  "identity", "location", "professional", "education", "relationships",
  "communication", "personality", "principles", "health", "hobbies",
  "food", "entertainment", "travel", "digital", "financial", "goals", "preferences",
];

export type ProfileEntryRow = {
  id: string;
  category_id: string;
  contact_id: string | null;
  label: string;
  value: string;
  sort_order: number | null;
  linked_note_id: string | null;
};

export type NormalizationGroup = {
  user_id: string;
  contact_id: string | null;
  member_entry_ids: string[];
  survivor_entry_id: string | null;
  canonical_category_slug: string;
  canonical_label: string;
  canonical_value: string;
  operation: "merge" | "relabel" | "recategorize" | "reformat";
  confidence: number;
  rationale: string;
};

export type NormalizationPayload = {
  user_id: string;
  contact_id: string | null;
  is_owner: boolean;
  canonical_category_slug: string;
  canonical_label: string;
  canonical_value: string;
  survivor_entry_id: string | null;
  before: ProfileEntryRow[];
  delete_entry_ids: string[];
  operation: string;
  rationale: string;
};

function buildSchemaDescription(): string {
  const lines: string[] = [];
  for (const [slug, schema] of Object.entries(PROFILE_CANONICAL_SCHEMA)) {
    if (schema.shape === "open" || schema.labels.length === 0) {
      lines.push(`- ${slug} (OPEN): keep user labels as-is; only group exact-meaning duplicates`);
      continue;
    }
    const names = schema.labels
      .map((l) => `${l.canonical} [${l.single ? "single" : "multi"}]`)
      .join(", ");
    lines.push(`- ${slug}: ${names}`);
  }
  return lines.join("\n");
}

const NORMALIZE_SYSTEM_PROMPT = `You normalize ONE person's profile (owner or contact). You receive a JSON list of their CURRENT profile_entries. Your job: produce groups of entries that should be merged/relabeled/recategorized/reformatted into a single canonical entry.

Canonical schema (per category, [single]=one truth per subject, [multi]=many allowed):
${buildSchemaDescription()}

Canonical label vocabulary you may use:
${CANONICAL_LABELS_FOR_PROMPT}

Rules:
1. Group entries that describe the SAME underlying fact. For each group choose:
   - canonical_category_slug (from the schema)
   - canonical_label (use the EXACT canonical label from the schema when it fits; for OPEN categories keep the user's natural label)
   - canonical_value: the RICHEST/most complete value (e.g. "Dortmund, Germany" over "Dortmund"; an ISO date "2006-01-23" over "January 23 2006"). Normalize dates to YYYY-MM-DD.
2. A [single] label may appear ONCE per subject. If two [single] entries hold genuinely DIFFERENT values that look like a CHANGE OVER TIME (moved cities, changed jobs), DO NOT merge them. Keep the most current as canonical. If a "Previous X" canonical exists (Previous city, Previous address, Previous employer) emit a separate relabel group for the older one. Otherwise leave both alone (do not emit a group).
3. NEVER collapse two genuinely different facts into one.
4. Open categories (personality, principles, health, hobbies, food, entertainment, travel, digital, goals, preferences): only group EXACT-meaning duplicates and fix wrong category. Never force a canonical label onto them.
5. Fix obviously wrong categories (e.g. "Place of birth" filed under location → identity; wedding/spouse → relationships).
6. Output ONLY groups that require a CHANGE. If an entry is already canonical, unique, and correctly categorized, omit it.
7. survivor_entry_id: pick the existing row that already best matches the canonical (richest value + correct category) so we UPDATE it in place. Set null only when no member is a good survivor; in that case the apply step will INSERT a fresh canonical and delete all members.
8. Only map an entry to a canonical label when the entry's VALUE is consistent with that label's meaning. Never relabel based on the label name alone when the value contradicts it (e.g. 'Humor Style: Witty' is NOT a Social handle). If a field is really a personality/communication-style trait, recategorize it to 'personality' and KEEP its existing label rather than forcing a canonical label. If you are unsure, leave the entry untouched (emit no group for it).

Return JSON ONLY in this shape (no prose):
{ "groups": [ { "member_entry_ids": ["uuid", ...], "survivor_entry_id": "uuid"|null, "canonical_category_slug": "string", "canonical_label": "string", "canonical_value": "string", "operation": "merge"|"relabel"|"recategorize"|"reformat", "confidence": 0.0, "rationale": "short string" } ] }`;

export async function planSubjectNormalization(args: {
  supabase: any;
  userId: string;
  contactId: string | null;
}): Promise<NormalizationGroup[]> {
  const { supabase, userId, contactId } = args;

  // Load all entries for this subject + their categories.
  let entryQuery = supabase
    .from("profile_entries")
    .select("id, category_id, contact_id, label, value, sort_order, linked_note_id")
    .eq("user_id", userId);
  entryQuery = contactId ? entryQuery.eq("contact_id", contactId) : entryQuery.is("contact_id", null);
  const { data: entries } = await entryQuery;
  const rows: ProfileEntryRow[] = (entries || []) as ProfileEntryRow[];
  if (rows.length <= 1) return [];

  const catIds = [...new Set(rows.map((r) => r.category_id))];
  const { data: cats } = await supabase
    .from("profile_categories")
    .select("id, slug")
    .in("id", catIds);
  const slugById = new Map<string, string>();
  for (const c of (cats || []) as any[]) slugById.set(c.id, c.slug);

  // --- Deterministic exact-duplicate collapser (runs BEFORE the LLM) ---
  // Cluster rows by (correctedCategorySlug, canonicalLabel, trimmed-lowercased value).
  // Any cluster of size > 1 is an unambiguous exact duplicate we can collapse
  // safely without asking the LLM.
  type ClusterMember = {
    row: ProfileEntryRow;
    currentSlug: string;
    correctedSlug: string;
    canonLabel: string;
  };
  const clusters = new Map<string, ClusterMember[]>();
  for (const row of rows) {
    const currentSlug = slugById.get(row.category_id) || "preferences";
    const correctedSlug = correctProfileCategory(row.label, currentSlug);
    const canonLabel = canonicalProfileLabel(correctedSlug, row.label);
    const normValue = (row.value || "").trim().toLowerCase();
    const clusterKey = `${correctedSlug}||${canonLabel.toLowerCase()}||${normValue}`;
    const bucket = clusters.get(clusterKey);
    const entry: ClusterMember = { row, currentSlug, correctedSlug, canonLabel };
    if (bucket) bucket.push(entry);
    else clusters.set(clusterKey, [entry]);
  }

  const deterministicGroups: NormalizationGroup[] = [];
  const deterministicIds = new Set<string>();
  for (const members of clusters.values()) {
    if (members.length < 2) continue;
    // Survivor preference: already in correct category AND already carrying canonical label.
    let survivor = members.find(
      (m) => m.currentSlug === m.correctedSlug && m.row.label === m.canonLabel,
    );
    if (!survivor) survivor = members[0];
    const memberIds = members.map((m) => m.row.id);
    for (const id of memberIds) deterministicIds.add(id);
    deterministicGroups.push({
      user_id: userId,
      contact_id: contactId,
      member_entry_ids: memberIds,
      survivor_entry_id: survivor.row.id,
      canonical_category_slug: survivor.correctedSlug,
      canonical_label: survivor.canonLabel,
      canonical_value: survivor.row.value, // original, non-lowercased
      operation: "merge",
      confidence: 1.0,
      rationale: "Exact duplicate entries collapsed to the canonical label/category.",
    });
  }

  // Build LLM input from rows NOT already owned by the deterministic pass.
  // This guarantees zero overlap: the LLM cannot see, and therefore cannot
  // touch, any row that the deterministic collapser has already claimed.
  const llmRows = rows.filter((r) => !deterministicIds.has(r.id));
  if (llmRows.length < 2) return deterministicGroups;

  const llmEntries = llmRows.map((r) => ({
    id: r.id,
    category: slugById.get(r.category_id) || "preferences",
    label: r.label,
    value: r.value,
  }));

  const userPrompt = `Subject: ${contactId ? `contact ${contactId}` : "owner (the user themself)"}\n\nCurrent profile entries (JSON):\n${JSON.stringify(llmEntries, null, 2)}\n\nReturn ONLY groups that require a change.`;

  let parsed: any = null;
  try {
    const result = await runChat({
      db: supabase,
      userId,
      callSite: "normalize-profile.plan",
      messages: [{ role: "user", content: userPrompt }],
      defaults: {
        provider: "openrouter",
        model: "deepseek/deepseek-v4-flash",
        systemPrompt: NORMALIZE_SYSTEM_PROMPT,
      },
      callOptions: { response_format: { type: "json_object" } },
    });
    parsed = JSON.parse(result.content);
  } catch (err) {
    console.error("[normalize-profile] LLM call failed:", err);
    return deterministicGroups;
  }

  const rawGroups: any[] = Array.isArray(parsed?.groups) ? parsed.groups : [];
  // Only non-deterministic row ids are valid for LLM groups — this rejects any
  // attempt (hallucinated or not) by the LLM to reference a row the
  // deterministic pass already owns.
  const validIds = new Set(llmRows.map((r) => r.id));
  const byId = new Map(rows.map((r) => [r.id, r]));
  const llmGroups: NormalizationGroup[] = [];


  for (const g of rawGroups) {
    if (!g || typeof g !== "object") continue;
    const memberIds: string[] = Array.isArray(g.member_entry_ids)
      ? g.member_entry_ids.filter((id: any) => typeof id === "string" && validIds.has(id))
      : [];
    if (memberIds.length === 0) continue;

    const survivor = typeof g.survivor_entry_id === "string" && validIds.has(g.survivor_entry_id)
      ? g.survivor_entry_id
      : null;
    if (survivor && !memberIds.includes(survivor)) memberIds.push(survivor);

    const slug = typeof g.canonical_category_slug === "string" ? g.canonical_category_slug : "";
    if (!PROFILE_CATEGORY_SLUGS.includes(slug)) continue;

    const label = String(g.canonical_label || "").trim();
    const value = String(g.canonical_value || "").trim();
    if (!label || !value) continue;

    // No-op check: every member already matches canonical category + label + value.
    const allEqual = memberIds.every((id) => {
      const r = byId.get(id);
      if (!r) return false;
      return r.label === label && r.value === value && slugById.get(r.category_id) === slug;
    });
    if (allEqual) continue;

    const op = ["merge", "relabel", "recategorize", "reformat"].includes(g.operation)
      ? g.operation
      : "merge";
    const conf = Math.max(0, Math.min(1, Number(g.confidence) || 0.7));

    out.push({
      user_id: userId,
      contact_id: contactId,
      member_entry_ids: memberIds,
      survivor_entry_id: survivor,
      canonical_category_slug: slug,
      canonical_label: label,
      canonical_value: value,
      operation: op,
      confidence: conf,
      rationale: String(g.rationale || "").slice(0, 500),
    });
  }
  return out;
}

function buildPayload(group: NormalizationGroup, rows: ProfileEntryRow[]): NormalizationPayload {
  const byId = new Map(rows.map((r) => [r.id, r]));
  const before: ProfileEntryRow[] = [];
  for (const id of group.member_entry_ids) {
    const r = byId.get(id);
    if (r) before.push(r);
  }
  const deleteIds = group.member_entry_ids.filter((id) => id !== group.survivor_entry_id);
  return {
    user_id: group.user_id,
    contact_id: group.contact_id,
    is_owner: group.contact_id === null,
    canonical_category_slug: group.canonical_category_slug,
    canonical_label: group.canonical_label,
    canonical_value: group.canonical_value,
    survivor_entry_id: group.survivor_entry_id,
    before,
    delete_entry_ids: deleteIds,
    operation: group.operation,
    rationale: group.rationale,
  };
}

type ReviewSuggestion = {
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

export async function createNormalizationSuggestions(args: {
  supabase: any;
  userId: string;
  contactId: string | null;
  preferences: { mode: string; sensitivity: string; autoAddSensitive: boolean };
  sourceNoteId?: string | null;
  // injected helpers from process-note (avoids circular import)
  helpers: {
    filterSuppressedSuggestions: (userId: string, s: ReviewSuggestion[]) => Promise<ReviewSuggestion[]>;
    prepareSuggestionForInsert: (s: ReviewSuggestion, prefs: any) => Promise<ReviewSuggestion>;
    isSensitiveSuggestion: (t: string, payload: Record<string, unknown>, text?: string) => boolean;
    buildSuppressionKey: (t: string, et: string | null, eid: string | null, v: unknown) => string;
  };
}): Promise<{ created: number; autoApplied: number }> {
  const { supabase, userId, contactId, preferences, sourceNoteId, helpers } = args;

  const groups = await planSubjectNormalization({ supabase, userId, contactId });
  if (groups.length === 0) return { created: 0, autoApplied: 0 };

  // Reload the subject's current rows so we can snapshot accurately.
  let entryQuery = supabase
    .from("profile_entries")
    .select("id, category_id, contact_id, label, value, sort_order, linked_note_id")
    .eq("user_id", userId);
  entryQuery = contactId ? entryQuery.eq("contact_id", contactId) : entryQuery.is("contact_id", null);
  const { data: entries } = await entryQuery;
  const rows: ProfileEntryRow[] = (entries || []) as ProfileEntryRow[];

  // Resolve subject name for nice titles.
  let subjectLabel = "your";
  if (contactId) {
    const { data: c } = await supabase.from("contacts").select("name").eq("id", contactId).maybeSingle();
    if (c?.name) subjectLabel = `${c.name}'s`;
  }

  // Existing normalize suggestions (for dedup by suppression_key).
  const { data: existingQueue } = await supabase
    .from("review_queue")
    .select("suppression_key, status")
    .eq("user_id", userId)
    .eq("suggestion_type", "normalize_profile_entry")
    .in("status", ["pending", "pending_review", "auto_applied_unreviewed", "kept", "accepted"]);
  const existingKeys = new Set(
    ((existingQueue || []) as any[]).map((q) => q.suppression_key).filter(Boolean),
  );

  const suggestions: ReviewSuggestion[] = [];
  for (const g of groups) {
    const payload = buildPayload(g, rows);
    if (payload.before.length === 0) continue;

    const suppression = helpers.buildSuppressionKey(
      "normalize_profile_entry",
      contactId ? "contact" : "owner",
      contactId,
      `${g.canonical_label}:${g.canonical_value}`,
    );
    if (existingKeys.has(suppression)) continue;

    suggestions.push({
      user_id: userId,
      source_note_id: sourceNoteId ?? null,
      suggestion_type: "normalize_profile_entry",
      title: `Clean up ${subjectLabel} profile: ${g.canonical_label}`,
      description: g.rationale || `Merge ${payload.before.length} entries → ${g.canonical_label}: ${g.canonical_value}`,
      payload: payload as unknown as Record<string, unknown>,
      status: "pending_review",
      target_entity_type: "profile_entry",
      source_title: null,
      extracted_value: `${g.canonical_label}: ${g.canonical_value}`,
      confidence_score: g.confidence,
      is_sensitive: helpers.isSensitiveSuggestion(
        "normalize_profile_entry",
        payload as unknown as Record<string, unknown>,
        "",
      ),
      suppression_key: suppression,
    });
  }

  if (suggestions.length === 0) return { created: 0, autoApplied: 0 };

  const unsuppressed = await helpers.filterSuppressedSuggestions(userId, suggestions);
  const prepared = await Promise.all(
    unsuppressed.map((s) => helpers.prepareSuggestionForInsert(s, preferences)),
  );
  const autoApplied = prepared.filter((p) => p.status === "auto_applied_unreviewed").length;

  const { error } = await supabase.from("review_queue").insert(prepared);
  if (error) {
    console.error("[normalize-profile] insert failed:", error);
    return { created: 0, autoApplied: 0 };
  }
  return { created: prepared.length, autoApplied };
}

// Resolve (or create) a profile_categories row for (user, slug, contact_id).
async function resolveCategoryId(
  supabase: any,
  userId: string,
  contactId: string | null,
  slug: string,
): Promise<string | null> {
  const base = supabase
    .from("profile_categories")
    .select("id")
    .eq("user_id", userId)
    .eq("slug", slug);
  const { data: existing } = contactId
    ? await base.eq("contact_id", contactId).maybeSingle()
    : await base.is("contact_id", null).maybeSingle();
  if (existing?.id) return existing.id;

  const { data: created, error } = await supabase
    .from("profile_categories")
    .insert({
      user_id: userId,
      contact_id: contactId,
      slug,
      name: slug.charAt(0).toUpperCase() + slug.slice(1),
      icon: "folder",
      is_default: false,
      sort_order: 99,
      visibility_scope: "all",
    } as any)
    .select("id")
    .maybeSingle();
  if (created?.id) return created.id;
  if (error && (error as any).code !== "23505") {
    console.error("[normalize-profile] category create failed:", error);
    return null;
  }
  const base2 = supabase
    .from("profile_categories")
    .select("id")
    .eq("user_id", userId)
    .eq("slug", slug);
  const { data: raced } = contactId
    ? await base2.eq("contact_id", contactId).maybeSingle()
    : await base2.is("contact_id", null).maybeSingle();
  return raced?.id || null;
}

export async function applyNormalization(
  supabase: any,
  payload: NormalizationPayload,
): Promise<{ ok: boolean; entryId?: string; reason?: string }> {
  try {
    // Staleness check — re-read every `before` row and confirm it still matches.
    const ids = payload.before.map((r) => r.id);
    if (ids.length === 0) return { ok: false, reason: "empty" };
    const { data: current } = await supabase
      .from("profile_entries")
      .select("id, category_id, label, value")
      .eq("user_id", payload.user_id)
      .in("id", ids);
    const cur = new Map(((current || []) as any[]).map((r) => [r.id, r]));
    for (const snap of payload.before) {
      const now = cur.get(snap.id);
      if (!now) return { ok: false, reason: "stale" };
      if (now.label !== snap.label || now.value !== snap.value || now.category_id !== snap.category_id) {
        return { ok: false, reason: "stale" };
      }
    }

    const categoryId = await resolveCategoryId(
      supabase,
      payload.user_id,
      payload.contact_id,
      payload.canonical_category_slug,
    );
    if (!categoryId) return { ok: false, reason: "category_unresolved" };

    let entryId: string;
    if (payload.survivor_entry_id) {
      const { data, error } = await supabase
        .from("profile_entries")
        .update({
          category_id: categoryId,
          label: payload.canonical_label,
          value: payload.canonical_value,
        })
        .eq("id", payload.survivor_entry_id)
        .eq("user_id", payload.user_id)
        .select("id")
        .single();
      if (error || !data) return { ok: false, reason: "update_failed" };
      entryId = data.id;
    } else {
      const { data, error } = await supabase
        .from("profile_entries")
        .insert({
          user_id: payload.user_id,
          contact_id: payload.contact_id,
          category_id: categoryId,
          label: payload.canonical_label,
          value: payload.canonical_value,
          sort_order: 0,
        } as any)
        .select("id")
        .single();
      if (error || !data) return { ok: false, reason: "insert_failed" };
      entryId = data.id;
    }

    const deleteIds = payload.survivor_entry_id
      ? payload.delete_entry_ids
      : payload.before.map((r) => r.id);
    if (deleteIds.length > 0) {
      const { error: delErr } = await supabase
        .from("profile_entries")
        .delete()
        .eq("user_id", payload.user_id)
        .in("id", deleteIds);
      if (delErr) console.error("[normalize-profile] delete failed:", delErr);
    }

    return { ok: true, entryId };
  } catch (err) {
    console.error("[normalize-profile] applyNormalization error:", err);
    return { ok: false, reason: "exception" };
  }
}

export async function rollbackNormalization(
  supabase: any,
  payload: NormalizationPayload,
  appliedEntryId?: string | null,
): Promise<void> {
  // Restore every `before` row byte-for-byte by id.
  const rowsToRestore = payload.before.map((r) => ({
    id: r.id,
    user_id: payload.user_id,
    category_id: r.category_id,
    contact_id: r.contact_id,
    label: r.label,
    value: r.value,
    sort_order: r.sort_order,
    linked_note_id: r.linked_note_id,
  }));
  if (rowsToRestore.length > 0) {
    const { error } = await supabase
      .from("profile_entries")
      .upsert(rowsToRestore as any, { onConflict: "id" });
    if (error) console.error("[normalize-profile] rollback upsert failed:", error);
  }

  // If apply INSERTED a brand-new canonical row, delete it.
  if (!payload.survivor_entry_id && appliedEntryId) {
    const { error } = await supabase
      .from("profile_entries")
      .delete()
      .eq("user_id", payload.user_id)
      .eq("id", appliedEntryId);
    if (error) console.error("[normalize-profile] rollback delete failed:", error);
  }
}
