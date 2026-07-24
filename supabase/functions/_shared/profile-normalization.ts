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
  isListValuedLabel,
  isSingleValueLabel,
  normalizeProfileValueForDedup,
  stripTrailingQualifier,
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
  created_at?: string | null;
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
  source?: "exact" | "list" | "soft_single" | "llm";
  auto_apply_direct?: boolean;
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

export function normalizeTokenForList(label: string, token: string): { key: string; display: string } {
  let cleaned = stripTrailingQualifier(token)
    .replace(/^(?:allerg(?:ic|y)|allergen)\s+(?:to\s+)?/i, "")
    .replace(/^(?:diagnosed\s+with|diagnosis\s*:?|condition\s*:?|has\s+)/i, "")
    .trim()
    .replace(/[.。]+$/u, "")
    .trim();
  if (!cleaned) cleaned = String(token || "").trim();

  const lower = cleaned.toLowerCase().replace(/\s+/g, " ");
  const labelLower = String(label || "").trim().toLowerCase();
  if (labelLower === "pets" || labelLower === "pet") {
    const petDisplay = cleaned
      .replace(/\(([^)]+)\)/g, "$1")
      .replace(/\bnamed\b/gi, "")
      .replace(/\s+/g, " ")
      .trim();
    const petKey = petDisplay.toLowerCase().replace(/\s+/g, " ");
    return { key: petKey, display: petDisplay };
  }
  const healthSynonyms: Record<string, string> = {
    "major depressive disorder": "MDD",
    "major depression": "MDD",
    "mdd": "MDD",
    "borderline personality disorder": "BPD",
    "bpd": "BPD",
    "autism spectrum disorder": "ASD",
    "autistic spectrum disorder": "ASD",
    "asd": "ASD",
    "avoidant personality disorder": "AVPD",
    "avpd": "AVPD",
  };

  if (String(label || "").trim().toLowerCase() === "health conditions") {
    const canonical = healthSynonyms[lower];
    if (canonical) return { key: canonical.toLowerCase(), display: canonical };
  }

  return { key: lower, display: cleaned };
}

export function splitListTokens(label: string, value: string): Array<{ key: string; display: string }> {
  return String(value || "")
    .replace(/^allergic\s+to\s+/i, "")
    .split(/[,;\/]|\band\b|\bund\b|\balso\b|\bor\b|\boder\b/i)
    .map((t) => normalizeTokenForList(label, t))
    .filter((t) => t.display.length > 0 && t.key.length > 0);
}

function comparableProfileValue(value: string): string {
  return normalizeProfileValueForDedup(value)
    .replace(/[()\[\]{}]/g, " ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function meaningfulTokenSet(value: string): Set<string> {
  const stop = new Set(["a", "an", "and", "as", "at", "for", "from", "has", "in", "is", "of", "on", "or", "the", "to", "with"]);
  return new Set(
    comparableProfileValue(value)
      .split(" ")
      .map((token) => token.trim())
      .filter((token) => token.length > 2 && !stop.has(token)),
  );
}

function isSubsumedValue(shorterValue: string, longerValue: string): boolean {
  const shorter = comparableProfileValue(shorterValue);
  const longer = comparableProfileValue(longerValue);
  if (!shorter || !longer || shorter === longer) return false;
  if (shorter.length >= 8 && longer.includes(shorter)) return true;
  const shortTokens = meaningfulTokenSet(shorterValue);
  if (shortTokens.size < 3) return false;
  const longTokens = meaningfulTokenSet(longerValue);
  return [...shortTokens].every((token) => longTokens.has(token));
}

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
9. TIME-BASED CONFLICTS (only when a "DATED EVIDENCE" section is provided below): When two [single] entries hold DIFFERENT values and the dated evidence shows the subject CHANGED over time (moved city/address, changed job/employer), set the MOST RECENT/current value as the canonical [single] entry (operation 'reformat' or 'relabel' as appropriate), AND emit a SEPARATE group that relabels the OLDER entry to its 'Previous X' canonical (Previous city / Previous address / Previous employer), operation 'relabel', keeping that older entry's value. Cite the evidence (note title or date) in the rationale. Only do this when the dated evidence supports it; if it remains unclear, leave both entries unchanged (emit nothing). Each such group has exactly one member entry.

Return JSON ONLY in this shape (no prose):
{ "groups": [ { "member_entry_ids": ["uuid", ...], "survivor_entry_id": "uuid"|null, "canonical_category_slug": "string", "canonical_label": "string", "canonical_value": "string", "operation": "merge"|"relabel"|"recategorize"|"reformat", "confidence": 0.0, "rationale": "short string" } ] }`;

export async function planSubjectNormalization(args: {
  supabase: any;
  userId: string;
  contactId: string | null;
  includeNotesContext?: boolean;
  deterministicOnly?: boolean;
}): Promise<NormalizationGroup[]> {
  const { supabase, userId, contactId, includeNotesContext = false, deterministicOnly = false } = args;

  // Load all entries for this subject + their categories.
  let entryQuery = supabase
    .from("profile_entries")
    .select("id, category_id, contact_id, label, value, sort_order, linked_note_id, created_at")
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

  // --- Boolean-value condition transform (in-plan only) ---
  // A "checkbox" extraction like {label: "BPD", value: "true"} filed under
  // `health` is really "Health conditions: BPD". Rewriting the row's label/
  // value here (before clustering) folds it into the list-valued merger with
  // every other Health-conditions row. Safe: the `before` snapshot used for
  // rollback is re-queried from the DB in createNormalizationSuggestions, so
  // this in-memory rewrite never lands in the snapshot.
  const BOOLEAN_VALUES = new Set(["true", "yes", "y", "x", "✓", "✔"]);
  for (const row of rows) {
    const slug = slugById.get(row.category_id) || "";
    if (slug !== "health") continue;
    const v = String(row.value || "").trim().toLowerCase();
    const orig = String(row.label || "").trim();
    const diagnosisMatch = orig.match(/^diagnosis\s*:\s*(.+)$/i);
    if (diagnosisMatch && diagnosisMatch[1]?.trim()) {
      row.label = "Health conditions";
      row.value = [diagnosisMatch[1].trim(), row.value].filter(Boolean).join(" ").trim();
      continue;
    }
    if (!BOOLEAN_VALUES.has(v)) continue;
    if (!orig || orig.length > 60 || /[:{}]/.test(orig)) continue;
    row.label = "Health conditions";
    row.value = orig;
  }

  // --- Deterministic exact-duplicate collapser (runs BEFORE the LLM) ---
  // Cluster rows by (correctedCategorySlug, canonicalLabel, dedup-normalized
  // value). Value normalization strips trailing parenthetical qualifiers, so
  // `5'4"` and `5'4" (fun sized)` land in the same cluster. Any cluster of
  // size > 1 is an unambiguous duplicate we can collapse without the LLM.
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
    const normValue = normalizeProfileValueForDedup(row.value || "");
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

    // Cluster values are equal after qualifier-stripping but may carry
    // DIFFERENT qualifiers ("Anna (goddaughter)" vs "Anna (from first
    // marriage)") — that can be two facts, so leave those for the LLM /
    // soft-single passes instead of merging blindly.
    const qualifiers = new Set(
      members
        .map((m) => {
          const raw = (m.row.value || "").trim();
          const base = stripTrailingQualifier(raw);
          return raw === base ? "" : raw.slice(base.length).trim().toLowerCase();
        })
        .filter((q) => q !== ""),
    );
    if (qualifiers.size > 1) continue;

    // Survivor preference: clean value (no trailing qualifier) already in the
    // correct category with the canonical label; then any clean value; then
    // canonical position. Because clean members win, the merged entry keeps
    // the qualifier-free value whenever one exists.
    const isClean = (m: ClusterMember) =>
      (m.row.value || "").trim() === stripTrailingQualifier(m.row.value || "");
    const isCanonicalPos = (m: ClusterMember) =>
      m.currentSlug === m.correctedSlug && m.row.label === m.canonLabel;
    const survivor =
      members.find((m) => isClean(m) && isCanonicalPos(m)) ||
      members.find(isClean) ||
      members.find(isCanonicalPos) ||
      members[0];
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
      rationale: "Duplicate entries (same fact) collapsed to the canonical label/category.",
      source: "exact",
      auto_apply_direct: true,
    });
  }

  // --- List-valued label merger (deterministic) ---
  // Nickname, Favorite food, Favorite drink, Love language, … are semantically
  // "a set of tokens". When two+ rows for the SAME (subject, canonical label)
  // survive the exact-duplicate pass with DIFFERENT values, we merge them into
  // one row whose value is the deduplicated, comma-joined union of the tokens
  // in every member. Auto-appliable (confidence 0.95) because the merge is
  // token-preserving and reversible.
  type ListMember = { row: ProfileEntryRow; correctedSlug: string; canonLabel: string };
  const listBuckets = new Map<string, ListMember[]>();
  for (const row of rows) {
    if (deterministicIds.has(row.id)) continue;
    const currentSlug = slugById.get(row.category_id) || "preferences";
    const correctedSlug = correctProfileCategory(row.label, currentSlug);
    const canonLabel = canonicalProfileLabel(correctedSlug, row.label);
    if (!isListValuedLabel(canonLabel)) continue;
    const key = `${correctedSlug}||${canonLabel.toLowerCase()}`;
    const m: ListMember = { row, correctedSlug, canonLabel };
    const bucket = listBuckets.get(key);
    if (bucket) bucket.push(m); else listBuckets.set(key, [m]);
  }
  const listValuedGroups: NormalizationGroup[] = [];
  for (const members of listBuckets.values()) {
    if (members.length < 2) continue;
    // Union tokens case-insensitively, keeping first-seen casing/order.
    const seen = new Set<string>();
    const union: string[] = [];
    for (const m of members) {
      for (const tok of splitListTokens(m.canonLabel, m.row.value)) {
        const key = tok.key;
        if (seen.has(key)) continue;
        seen.add(key);
        union.push(tok.display);
      }
    }
    if (union.length === 0) continue;
    // Survivor: already in the corrected category + canonical label; else the
    // row with the richest token set; else first.
    const tokenCount = (m: ListMember) => splitListTokens(m.canonLabel, m.row.value).length;
    const inCanonicalPos = (m: ListMember) =>
      slugById.get(m.row.category_id) === m.correctedSlug && m.row.label === m.canonLabel;
    let survivor = members.find(inCanonicalPos) || members[0];
    for (const cand of members) {
      if (tokenCount(cand) > tokenCount(survivor)) survivor = cand;
    }
    const memberIds = members.map((m) => m.row.id);
    const newValue = union.join(", ");
    // No-op if survivor already carries the full canonical value AND every other
    // member is exactly equal to it (extremely rare — exact-dup pass would have
    // caught it; guard anyway).
    const survivorValue = survivor.row.value?.trim() ?? "";
    if (
      survivorValue === newValue &&
      members.every((m) => (m.row.value || "").trim().toLowerCase() === newValue.toLowerCase())
    ) continue;
    for (const id of memberIds) deterministicIds.add(id);
    listValuedGroups.push({
      user_id: userId,
      contact_id: contactId,
      member_entry_ids: memberIds,
      survivor_entry_id: survivor.row.id,
      canonical_category_slug: survivor.correctedSlug,
      canonical_label: survivor.canonLabel,
      canonical_value: newValue,
      operation: "merge",
      confidence: 0.95,
      rationale: `Merged ${members.length} '${survivor.canonLabel}' entries into one comma-list of ${union.length} value(s).`,
      source: "list",
      auto_apply_direct: true,
    });
  }

  // --- Same-field subsumption merger (deterministic) ---
  // If one value for the SAME canonical field clearly contains another, keep
  // the richest value and delete the shorter duplicate. This covers extractor
  // repeats like "Weak Hero" / "Weak Hero Season 2" without asking the LLM.
  type SubsumedMember = { row: ProfileEntryRow; correctedSlug: string; canonLabel: string };
  const subsumptionBuckets = new Map<string, SubsumedMember[]>();
  for (const row of rows) {
    if (deterministicIds.has(row.id)) continue;
    const currentSlug = slugById.get(row.category_id) || "preferences";
    const correctedSlug = correctProfileCategory(row.label, currentSlug);
    const canonLabel = canonicalProfileLabel(correctedSlug, row.label);
    const key = `${correctedSlug}||${canonLabel.toLowerCase()}`;
    const member: SubsumedMember = { row, correctedSlug, canonLabel };
    const bucket = subsumptionBuckets.get(key);
    if (bucket) bucket.push(member); else subsumptionBuckets.set(key, [member]);
  }
  const subsumptionGroups: NormalizationGroup[] = [];
  for (const members of subsumptionBuckets.values()) {
    if (members.length < 2) continue;
    const sorted = [...members].sort((a, b) => comparableProfileValue(b.row.value).length - comparableProfileValue(a.row.value).length);
    const survivor = sorted[0];
    const subsumed = sorted.filter((m) => m.row.id !== survivor.row.id && isSubsumedValue(m.row.value, survivor.row.value));
    if (subsumed.length === 0) continue;
    const memberIds = [survivor, ...subsumed].map((m) => m.row.id);
    for (const id of memberIds) deterministicIds.add(id);
    subsumptionGroups.push({
      user_id: userId,
      contact_id: contactId,
      member_entry_ids: memberIds,
      survivor_entry_id: survivor.row.id,
      canonical_category_slug: survivor.correctedSlug,
      canonical_label: survivor.canonLabel,
      canonical_value: survivor.row.value,
      operation: "merge",
      confidence: 0.95,
      rationale: `Removed ${subsumed.length} shorter duplicate '${survivor.canonLabel}' value(s) already covered by the richest entry.`,
      source: "exact",
      auto_apply_direct: true,
    });
  }

  // --- Soft single-label multiplicity detector (deterministic) ---
  // For canonical [single] labels with 2+ rows AND 2+ distinct values: emit a
  // low-confidence (0.55) merge group so it routes to REVIEW (never auto-applies).
  // The user picks the right value. This guarantees duplicates never pass silently
  // when the LLM non-deterministically fails to merge them.
  type SoftMember = { row: ProfileEntryRow; correctedSlug: string; canonLabel: string };
  const softBuckets = new Map<string, SoftMember[]>();
  for (const row of rows) {
    if (deterministicIds.has(row.id)) continue;
    const currentSlug = slugById.get(row.category_id) || "preferences";
    const correctedSlug = correctProfileCategory(row.label, currentSlug);
    const canonLabel = canonicalProfileLabel(correctedSlug, row.label);
    if (!isSingleValueLabel(canonLabel)) continue;
    const key = `${correctedSlug}||${canonLabel.toLowerCase()}`;
    const m: SoftMember = { row, correctedSlug, canonLabel };
    const bucket = softBuckets.get(key);
    if (bucket) bucket.push(m); else softBuckets.set(key, [m]);
  }
  const softSingleGroups: NormalizationGroup[] = [];
  for (const members of softBuckets.values()) {
    if (members.length < 2) continue;
    const distinctValues = new Set(members.map((m) => (m.row.value || "").trim().toLowerCase()));
    if (distinctValues.size < 2) continue;
    // Survivor: longest trimmed value; tie → already in corrected category.
    let survivor = members[0];
    let survivorLen = (survivor.row.value || "").trim().length;
    let survivorInCorrect = slugById.get(survivor.row.category_id) === survivor.correctedSlug;
    for (const cand of members.slice(1)) {
      const candLen = (cand.row.value || "").trim().length;
      const candInCorrect = slugById.get(cand.row.category_id) === cand.correctedSlug;
      if (candLen > survivorLen || (candLen === survivorLen && candInCorrect && !survivorInCorrect)) {
        survivor = cand;
        survivorLen = candLen;
        survivorInCorrect = candInCorrect;
      }
    }
    const memberIds = members.map((m) => m.row.id);
    for (const id of memberIds) deterministicIds.add(id);
    softSingleGroups.push({
      user_id: userId,
      contact_id: contactId,
      member_entry_ids: memberIds,
      survivor_entry_id: survivor.row.id,
      canonical_category_slug: survivor.correctedSlug,
      canonical_label: survivor.canonLabel,
      canonical_value: survivor.row.value,
      operation: "merge",
      confidence: 0.55,
      rationale: `Multiple entries share the single-value field '${survivor.canonLabel}'; choose one.`,
      source: "soft_single",
      auto_apply_direct: false,
    });
  }

  // Build LLM input from rows NOT already owned by the deterministic passes.
  // This guarantees zero overlap: the LLM cannot see, and therefore cannot
  // touch, any row claimed by the exact-duplicate or soft-single passes.
  const llmRows = rows.filter((r) => !deterministicIds.has(r.id));
  if (deterministicOnly) return deterministicGroups.concat(listValuedGroups).concat(softSingleGroups);
  if (llmRows.length < 2) return deterministicGroups.concat(listValuedGroups).concat(softSingleGroups);

  const llmEntries = llmRows.map((r) => ({
    id: r.id,
    category: slugById.get(r.category_id) || "preferences",
    label: r.label,
    value: r.value,
    created_at: r.created_at || null,
  }));

  // Optional dated-evidence assembly for time-conflict resolution.
  // Large-profile guard: shrink prompt budget for big subjects to avoid
  // WORKER_RESOURCE_LIMIT (observed on a 37-entry contact w/ notes context).
  const isBigProfile = rows.length > 25;
  const CHAR_BUDGET = isBigProfile ? 2500 : 6000;
  const SUBJECT_NOTES_LIMIT = isBigProfile ? 8 : 15;
  let evidenceBlock = "";
  if (includeNotesContext) {
    try {
      const notesById = new Map<string, { id: string; title: string; date: string; snippet: string }>();
      const addNote = (n: any) => {
        if (!n?.id || notesById.has(n.id)) return;
        const date = (n.created_at || "").slice(0, 10);
        const title = String(n.title || "Untitled").slice(0, 120);
        const body = String(n.content || "").replace(/\s+/g, " ").trim();
        notesById.set(n.id, { id: n.id, title, date, snippet: body });
      };

      // (b) Notes linked from profile entries
      const linkedIds = [...new Set(rows.map((r) => r.linked_note_id).filter(Boolean) as string[])];
      if (linkedIds.length > 0) {
        const { data: linked } = await supabase
          .from("notes")
          .select("id, title, content, created_at")
          .in("id", linkedIds)
          .eq("user_id", userId);
        for (const n of (linked || []) as any[]) addNote(n);
      }

      // (c) Subject notes
      let subjectNotes: any[] = [];
      if (contactId) {
        const { data } = await supabase
          .from("notes")
          .select("id, title, content, created_at, metadata")
          .eq("user_id", userId)
          .eq("is_trashed", false)
          .contains("metadata", { matched_people: [contactId] })
          .order("created_at", { ascending: false })
          .limit(SUBJECT_NOTES_LIMIT);
        subjectNotes = (data || []) as any[];
      } else {
        const { data } = await supabase
          .from("notes")
          .select("id, title, content, created_at")
          .eq("user_id", userId)
          .eq("is_trashed", false)
          .order("created_at", { ascending: false })
          .limit(SUBJECT_NOTES_LIMIT);
        subjectNotes = (data || []) as any[];
      }
      for (const n of subjectNotes) addNote(n);

      // Order newest first, truncate snippets, drop oldest if over budget.
      const ordered = [...notesById.values()].sort((a, b) => (b.date || "").localeCompare(a.date || ""));
      const lines: string[] = [];
      let used = 0;
      for (const n of ordered) {
        const snipLen = linkedIds.includes(n.id) ? 240 : 200;
        const snip = n.snippet.slice(0, snipLen);
        const line = `- [${n.date || "unknown"}] ${n.title}: ${snip}`;
        if (used + line.length + 1 > CHAR_BUDGET) break;
        lines.push(line);
        used += line.length + 1;
      }
      if (lines.length > 0) {
        evidenceBlock = `\n\nDATED EVIDENCE (notes & timestamps), newest first:\n${lines.join("\n")}`;
      }
    } catch (e) {
      console.error("[normalize-profile] evidence assembly failed:", e);
    }
  }

  const userPrompt = `Subject: ${contactId ? `contact ${contactId}` : "owner (the user themself)"}\n\nCurrent profile entries (JSON, includes created_at):\n${JSON.stringify(llmEntries, null, 2)}${evidenceBlock}\n\nReturn ONLY groups that require a change.`;

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
    return deterministicGroups.concat(listValuedGroups).concat(softSingleGroups);
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

    // Lossy-merge guard: reject groups where members differ in BOTH value AND
    // canonical label (e.g. City:São Paulo + Country:Brazil under "Current city").
    // Same value w/ different labels OR same canonical label w/ different values
    // remain allowed — only the both-different case is data loss.
    const memberRows = memberIds.map((id) => byId.get(id)).filter(Boolean) as ProfileEntryRow[];
    const distinctValues = new Set(
      memberRows.map((r) => (r.value || "").trim().toLowerCase()),
    ).size;
    const distinctCanonLabels = new Set(
      memberRows.map((r) => canonicalProfileLabel(slug, r.label)),
    ).size;
    if (distinctValues >= 2 && distinctCanonLabels >= 2) {
      console.warn(
        `[normalize-profile] rejected lossy merge: combines different facts (${distinctValues} values / ${distinctCanonLabels} canonical labels)`,
      );
      continue;
    }


    const op = ["merge", "relabel", "recategorize", "reformat"].includes(g.operation)
      ? g.operation
      : "merge";
    const conf = Math.max(0, Math.min(1, Number(g.confidence) || 0.7));

    llmGroups.push({
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
      source: "llm",
      auto_apply_direct: false,
    });
  }
  return deterministicGroups.concat(listValuedGroups).concat(softSingleGroups).concat(llmGroups);
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
  includeNotesContext?: boolean;
  deterministicOnly?: boolean;
  // injected helpers from process-note (avoids circular import)
  helpers: {
    filterSuppressedSuggestions: (userId: string, s: any[]) => Promise<any[]>;
    prepareSuggestionForInsert: (s: any, prefs: any) => Promise<any>;
    isSensitiveSuggestion: (t: string, payload: Record<string, unknown>, text?: string) => boolean;
    buildSuppressionKey: (t: string, et: string | null, eid: string | null, v: unknown) => string;
  };
}): Promise<{ created: number; autoApplied: number; planned: number; applied: number; review: number; skipped: number }> {
  const { supabase, userId, contactId, sourceNoteId, helpers, includeNotesContext = false, deterministicOnly = false } = args;

  const groups = await planSubjectNormalization({ supabase, userId, contactId, includeNotesContext, deterministicOnly });
  if (groups.length === 0) return { created: 0, autoApplied: 0, planned: 0, applied: 0, review: 0, skipped: 0 };

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

  // Existing normalize suggestions (for dedup by suppression_key). Only active
  // queue rows should block a fresh plan. Historical kept/accepted rows may be
  // stale after new facts arrive, and blocking on them leaves duplicates stuck.
  const { data: existingQueue } = await supabase
    .from("review_queue")
    .select("suppression_key, status")
    .eq("user_id", userId)
    .eq("suggestion_type", "normalize_profile_entry")
    .in("status", ["pending", "pending_review", "auto_applied_unreviewed"]);
  const existingKeys = new Set(
    ((existingQueue || []) as any[]).map((q) => q.suppression_key).filter(Boolean),
  );

  const makeSuggestion = (g: NormalizationGroup, payload: NormalizationPayload): ReviewSuggestion => {
    const suppression = helpers.buildSuppressionKey(
      "normalize_profile_entry",
      contactId ? "contact" : "owner",
      contactId,
      `${g.canonical_label}:${g.canonical_value}`,
    );

    return {
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
    };
  };

  const reviewSuggestions: ReviewSuggestion[] = [];
  const auditRows: ReviewSuggestion[] = [];
  let applied = 0;
  let skipped = 0;

  for (const g of groups) {
    const payload = buildPayload(g, rows);
    if (payload.before.length === 0) {
      skipped += 1;
      continue;
    }

    const suggestion = makeSuggestion(g, payload);
    if (g.auto_apply_direct) {
      const result = await applyNormalization(supabase, payload);
      if (result.ok && result.entryId) {
        applied += 1;
        auditRows.push({
          ...suggestion,
          status: "kept",
          target_entity_id: result.entryId,
          applied_at: new Date().toISOString(),
        });
      } else {
        skipped += 1;
        console.warn(`[normalize-profile] direct apply skipped: ${result.reason || "unknown"}`);
      }
      continue;
    }

    if (suggestion.suppression_key && existingKeys.has(suggestion.suppression_key)) {
      skipped += 1;
      continue;
    }
    reviewSuggestions.push(suggestion);
  }

  let created = 0;
  if (auditRows.length > 0) {
    const { error } = await supabase.from("review_queue").insert(auditRows);
    if (error) console.error("[normalize-profile] audit insert failed:", error);
    else created += auditRows.length;
  }

  if (reviewSuggestions.length === 0) {
    return { created, autoApplied: applied, planned: groups.length, applied, review: 0, skipped };
  }

  const unsuppressed = await helpers.filterSuppressedSuggestions(userId, reviewSuggestions);
  const prepared = unsuppressed.map((s) => ({ ...s, status: "pending_review" }));

  if (prepared.length > 0) {
    const { error } = await supabase.from("review_queue").insert(prepared);
    if (error) {
      console.error("[normalize-profile] insert failed:", error);
      skipped += prepared.length;
    } else {
      created += prepared.length;
    }
  }

  return {
    created,
    autoApplied: applied,
    planned: groups.length,
    applied,
    review: prepared.length,
    skipped: skipped + (reviewSuggestions.length - prepared.length),
  };
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
      if (error && (error as any).code === "23505") return { ok: false, reason: "already_exists" };
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
      if (error && (error as any).code === "23505") return { ok: false, reason: "already_exists" };
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
