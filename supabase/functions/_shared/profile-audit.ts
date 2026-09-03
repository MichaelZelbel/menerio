/**
 * Whole-profile duplicate audit.
 *
 * The auditor never writes to the database. It receives every profile entry of
 * one person, asks one LLM question ("which of these entries state the same
 * fact?"), and returns a deterministic merge plan that the caller applies via
 * `profile_audit_apply_merge`.
 *
 * Everything in this module is pure TypeScript so it can be unit tested in the
 * Node/vitest runner alongside the frontend.
 */

export type AuditEntry = {
  id: string;
  category_slug: string;
  label: string;
  value: string;
  is_pinned?: boolean;
  created_at?: string;
  origin?: string;
  /**
   * `preferred` means a human typed this row. The database refuses a machine's
   * DELETE of it (`world_preferred_survives_delete`) and silently restores its
   * label and value on a machine's UPDATE (`world_preferred_wins`), both without
   * raising. Loading this field is what stops the planner proposing work the
   * database will always refuse; leaving it out is what let the audit ask the
   * same impossible question 1,049 times over 52 hours.
   */
  rank?: string;
};

/**
 * True when nothing a background job does can remove or reword this entry.
 *
 * `is_pinned` is the user's explicit "leave this alone". `rank === 'preferred'`
 * is the same protection applied automatically to anything a human typed. The
 * audit runs as the service role on every path, including the user-triggered
 * `run` action, so the machine rules always apply here.
 */
export function isProtected(e: AuditEntry): boolean {
  return Boolean(e.is_pinned) || e.rank === "preferred";
}

/**
 * A stable signature of the entry list, used by the caller to notice that a
 * round changed nothing and stop before paying for another identical model
 * call. Sorted, so a reordered read of the same rows is the same fingerprint.
 */
export function entriesFingerprint(entries: AuditEntry[]): string {
  return entries
    .map((e) => `${e.id}${e.label}${e.value}`)
    .sort()
    .join("");
}

export type LlmGroup = {
  ids: string[];
  label?: string;
  value?: string;
  reason?: string;
};

export type LlmAuditResponse = {
  groups?: LlmGroup[];
  none?: boolean;
};

export type MergePlanItem = {
  keepId: string;
  removeIds: string[];
  label: string;
  value: string;
  reason: string;
};

export type RejectedGroup = {
  ids: string[];
  reason: string;
};

export type MergePlan = {
  merges: MergePlanItem[];
  rejected: RejectedGroup[];
};

export const PROFILE_AUDIT_SYSTEM_PROMPT =
  `You are the duplicate auditor for a personal knowledge base's people profiles.

You receive ALL profile entries of ONE person. Each entry has an id, a category, a label and a value.

Your only job: find every set of entries that state the SAME underlying fact, even when the labels are worded differently, and say what the single correct entry should be.

Treat these as the same fact:
- Different wordings of the same field ("Second job" / "Additional work" / "Other occupation" with the same employer).
- A qualifier of a fact stored as its own entry ("Age moved out: 16" and "Life events: moved out at 16" are ONE fact).
- Synonyms of name fields ("Nickname" / "Aka" / "Alias" / "Alternative name").
- The same value written with different spelling, casing, punctuation or transliteration.
- A short value that is fully contained in a longer, richer value of the same fact.

Do NOT group:
- Two genuinely different facts that merely share a category (two different employers, two different children, two different hobbies).
- Entries whose values contradict each other in a way that would lose information if merged — leave those alone.

Rules for the merged entry:
- "label" MUST be one of the labels already used by the entries in that group. Never invent a new label.
- "value" MUST preserve every piece of information from all grouped entries. If you cannot express all of it in one value, do not group them.
- Give a one-sentence "reason".

Entries marked "protected" were typed by the person themselves and are fixed. You may not remove one, and you may not reword one:
- A group MAY contain a protected entry, but only if the single correct entry is that protected entry with its value UNCHANGED, and every other entry in the group is unprotected.
- Never propose a group in which every entry is protected.
- Never propose a "value" for a protected entry that differs from the value it already has, even to add detail. If the full fact needs wording the protected entry does not have, leave the group alone.

Return STRICT JSON only:
{"groups":[{"ids":["<id>","<id>"],"label":"<label>","value":"<merged value>","reason":"<why>"}],"none":false}
If there are no duplicates at all, return {"groups":[],"none":true}.`;

/** Serialize the whole profile for the audit prompt. */
export function buildAuditUserMessage(
  personName: string,
  entries: AuditEntry[],
  rejectedNotes: string[] = [],
): string {
  // The marker is appended only when true, so the common case costs no tokens.
  const lines = entries.map((e) =>
    `- id=${e.id} | category=${e.category_slug} | label=${e.label} | value=${e.value}` +
    (isProtected(e) ? " | protected" : "")
  );
  const rejectedBlock = rejectedNotes.length > 0
    ? [
      "",
      "Already rejected in an earlier round (do NOT propose these again; if you still think they belong together, provide a merged value that keeps EVERY detail from EVERY entry):",
      ...rejectedNotes.slice(0, 40).map((r) => `- ${r}`),
    ]
    : [];
  return [
    `Person: ${personName || "the profile owner"}`,
    `Entries (${entries.length}):`,
    ...lines,
    ...rejectedBlock,
    "",
    "Return the JSON object described in your instructions.",
  ].join("\n");
}


export function normalizeText(input: string): string {
  return String(input || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9äöüß\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const STOPWORDS = new Set([
  "the", "a", "an", "at", "in", "on", "of", "to", "and", "or", "is", "was", "were",
  "her", "his", "their", "my", "for", "with", "as", "by",
]);

export function contentTokens(input: string): string[] {
  return normalizeText(input)
    .split(" ")
    .filter((t) => t.length > 0 && !STOPWORDS.has(t));
}

/**
 * True when every meaning-bearing token of `part` also occurs in `whole`.
 * Used as the deterministic no-information-loss guard on merged values.
 */
export function valueCovers(whole: string, part: string): boolean {
  const wholeTokens = contentTokens(whole);
  const partTokens = contentTokens(part);
  if (partTokens.length === 0) return true;
  const bag = new Map<string, number>();
  for (const t of wholeTokens) bag.set(t, (bag.get(t) || 0) + 1);
  for (const t of partTokens) {
    const left = bag.get(t) || 0;
    if (left <= 0) return false;
    bag.set(t, left - 1);
  }
  return true;
}

function labelKey(label: string): string {
  return normalizeText(label);
}

/** Parse a raw LLM answer into a validated response object. */
export function parseAuditResponse(raw: string): LlmAuditResponse {
  if (!raw) return { groups: [], none: true };
  let text = raw.trim();
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) text = fence[1].trim();
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return { groups: [], none: true };
  try {
    const parsed = JSON.parse(text.slice(start, end + 1));
    const groups = Array.isArray(parsed?.groups) ? parsed.groups : [];
    return { groups, none: Boolean(parsed?.none) && groups.length === 0 };
  } catch {
    return { groups: [], none: true };
  }
}

/**
 * Turn the LLM's groups into a deterministic, safe merge plan.
 *
 * Rejects a group when:
 *  - it references unknown ids, or fewer than two real entries
 *  - an id is claimed by more than one group
 *  - the proposed label is not one of the labels already used by the group
 *  - the proposed value would drop information from any group member
 *  - every member is protected, pinned or hand-typed (nothing may be removed)
 *  - the keeper must be a protected row whose wording cannot carry the merged
 *    value, so applying it would lose what the other rows said
 */
export function planMerges(entries: AuditEntry[], groups: LlmGroup[]): MergePlan {
  const byId = new Map(entries.map((e) => [e.id, e]));
  const claimed = new Set<string>();
  const merges: MergePlanItem[] = [];
  const rejected: RejectedGroup[] = [];

  for (const group of groups || []) {
    const ids = Array.from(new Set((group?.ids || []).filter((id) => typeof id === "string")));
    const rows = ids.map((id) => byId.get(id)).filter(Boolean) as AuditEntry[];

    if (rows.length !== ids.length) {
      rejected.push({ ids, reason: "unknown_entry_id" });
      continue;
    }
    if (rows.length < 2) {
      rejected.push({ ids, reason: "not_a_group" });
      continue;
    }
    if (ids.some((id) => claimed.has(id))) {
      rejected.push({ ids, reason: "id_claimed_twice" });
      continue;
    }

    const allowedLabels = new Map(rows.map((r) => [labelKey(r.label), r.label]));
    const proposedLabel = String(group?.label || "").trim();
    const resolvedLabel = allowedLabels.get(labelKey(proposedLabel));
    if (!resolvedLabel) {
      rejected.push({ ids, reason: "label_not_in_group" });
      continue;
    }

    const proposedValue = String(group?.value || "").trim();
    if (!proposedValue) {
      rejected.push({ ids, reason: "empty_value" });
      continue;
    }
    const lossy = rows.find((r) => !valueCovers(proposedValue, r.value));
    if (lossy) {
      rejected.push({ ids, reason: "lossy_merge" });
      continue;
    }

    // Deterministic keep choice: protected first, then the label that matches
    // the resolved label, then the oldest row, then id order for stability.
    // Protected must sort first because it is the one row that cannot be
    // removed, so it is the only row that can survive as the keeper.
    const sorted = [...rows].sort((a, b) => {
      const prot = Number(isProtected(b)) - Number(isProtected(a));
      if (prot !== 0) return prot;
      const lab = Number(labelKey(b.label) === labelKey(resolvedLabel)) -
        Number(labelKey(a.label) === labelKey(resolvedLabel));
      if (lab !== 0) return lab;
      const at = String(a.created_at || "");
      const bt = String(b.created_at || "");
      if (at !== bt) return at < bt ? -1 : 1;
      return a.id < b.id ? -1 : 1;
    });

    const keep = sorted[0];
    const removeIds = sorted.slice(1).filter((r) => !isProtected(r)).map((r) => r.id);
    if (removeIds.length === 0) {
      rejected.push({ ids, reason: "all_protected" });
      continue;
    }

    // A protected keeper's words are immutable to a background job, so the
    // merged value can only be applied if the keeper already says it. When it
    // does not, applying the merge would delete the other rows and silently
    // drop what they carried, which is the information loss `valueCovers`
    // exists to prevent. Reject instead, and let a human resolve it: they can
    // edit a preferred row, a machine cannot.
    let effectiveLabel = resolvedLabel;
    let effectiveValue = proposedValue;
    if (isProtected(keep) && normalizeText(proposedValue) !== normalizeText(keep.value)) {
      const stillLossy = rows.find((r) => !valueCovers(keep.value, r.value));
      if (stillLossy) {
        rejected.push({ ids, reason: "protected_value_immutable" });
        continue;
      }
      // The keeper's existing wording already covers every value in the group,
      // so the duplicates can go and nothing is lost.
      effectiveLabel = keep.label;
      effectiveValue = keep.value;
    }

    for (const id of ids) claimed.add(id);
    merges.push({
      keepId: keep.id,
      removeIds,
      label: effectiveLabel,
      value: effectiveValue,
      reason: String(group?.reason || "duplicate fact"),
    });
  }

  return { merges, rejected };
}

/**
 * Cheap deterministic pre-pass: collapse entries whose label AND value are
 * equivalent after normalization. Runs before the LLM to keep the prompt small
 * and to guarantee the trivial cases never depend on a model call.
 */
export function planExactDuplicates(entries: AuditEntry[]): MergePlanItem[] {
  const clusters = new Map<string, AuditEntry[]>();
  for (const e of entries) {
    const key = `${e.category_slug}::${labelKey(e.label)}::${normalizeText(e.value)}`;
    if (!clusters.has(key)) clusters.set(key, []);
    clusters.get(key)!.push(e);
  }
  const plan: MergePlanItem[] = [];
  for (const rows of clusters.values()) {
    if (rows.length < 2) continue;
    const sorted = [...rows].sort((a, b) => {
      const prot = Number(isProtected(b)) - Number(isProtected(a));
      if (prot !== 0) return prot;
      const at = String(a.created_at || "");
      const bt = String(b.created_at || "");
      if (at !== bt) return at < bt ? -1 : 1;
      return a.id < b.id ? -1 : 1;
    });
    const keep = sorted[0];
    const removeIds = sorted.slice(1).filter((r) => !isProtected(r)).map((r) => r.id);
    if (removeIds.length === 0) continue;
    plan.push({
      keepId: keep.id,
      removeIds,
      label: keep.label,
      value: keep.value,
      reason: "identical label and value",
    });
  }
  return plan;
}
