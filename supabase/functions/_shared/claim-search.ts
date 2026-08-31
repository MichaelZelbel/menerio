/**
 * Searching the structured layer.
 *
 * Everything in this file is a pure function over rows `match_claims`
 * returned, which is what makes it testable without a database.
 *
 * Two callers, and they must behave identically:
 *   - menerio-mcp `search_brain`, which is what an outside agent sees
 *   - _shared/read-tools.ts `search_claims`, which is what the in-app
 *     assistant sees
 *
 * They were not identical once, and that is the reason this file moved here.
 * The MCP could answer "what is my street address" from a dated claim while
 * the assistant in the app said it had no address on file, because the app's
 * chat functions queried notes and media and nothing else. The same fact
 * store has to answer both, or the app is lying about what it knows.
 *
 * Mirrors nothing: this has no frontend twin.
 */

export interface ClaimHit {
  kind: "claim";
  id: string;
  subject_type: string;
  subject_id: string | null;
  subject: string;
  attribute: string;
  value: string;
  valid_from: string | null;
  valid_to: string | null;
  confidence: string | null;
  cardinality: "one" | "many" | string | null;
  review_by: string | null;
  evidence_quote: string | null;
  source_type: string | null;
  source_id: string | null;
  similarity: number;
  /** Other live values for the same subject+attribute. Reported, never resolved. */
  conflicts_with?: string[];
  /** The review date, when it has passed. Null when the fact is still inside its window. */
  stale_since?: string | null;
}

/**
 * Flags every group of live claims that share a subject and a SINGLE-valued
 * attribute but disagree on the value.
 *
 * The conflict is REPORTED, never resolved. Picking a winner here is how a
 * real fact disappears: "manager" held both a line manager and a manager in a
 * project, two different people, both correct, and a merge would have
 * destroyed one of them. Two live answers usually mean the attribute name is
 * too coarse, not that a value is wrong.
 */
export function flagConflicts(hits: ClaimHit[]): ClaimHit[] {
  const groups = new Map<string, ClaimHit[]>();
  for (const h of hits) {
    if (h.cardinality === "many") continue; // several live values are normal here
    const key = `${h.subject_type}:${h.subject_id ?? "self"}|${String(h.attribute).trim().toLowerCase()}`;
    const group = groups.get(key);
    if (group) group.push(h);
    else groups.set(key, [h]);
  }
  for (const group of groups.values()) {
    // The same value written twice is duplication, not disagreement.
    const distinct = new Set(group.map((g) => g.value.trim().toLowerCase()));
    if (distinct.size < 2) continue;
    for (const h of group) {
      h.conflicts_with = group.filter((g) => g.id !== h.id).map((g) => g.value);
    }
  }
  return hits;
}

/**
 * Marks a hit whose review date has passed.
 *
 * It is still returned and still ranked normally: the reader is told the fact
 * is old, not denied it. This is the half of the model that catches the rot
 * nothing else can see, where one value sits uncontradicted and simply stops
 * being true.
 */
export function flagStale(hits: ClaimHit[], today: string): ClaimHit[] {
  for (const h of hits) {
    const closed = h.valid_to !== null && h.valid_to <= today;
    h.stale_since = !closed && h.review_by && h.review_by <= today ? h.review_by : null;
  }
  return hits;
}

/**
 * The day staleness is judged against.
 *
 * `match_claims` filters validity in SQL against the user's OWN day, computed
 * from their timezone, and it does that whenever `p_as_of` is null. This side
 * has to agree with it or a fact can be live in the WHERE clause and stale in
 * the badge on the same row.
 *
 * When the caller named a date, that date is the answer. When it did not, the
 * newest `valid_from` in the result set is the closest thing this side has to
 * the user's today, and never earlier than UTC today: a user at UTC+2 who
 * states a fact at 00:30 local is on tomorrow's date while the server is not.
 */
export function judgeDayFor(asOf: string | null, hits: ClaimHit[], utcToday: string): string {
  if (asOf) return asOf;
  const candidates = [utcToday, ...hits.map((h) => h.valid_from).filter((d): d is string => !!d)];
  return candidates.sort().reverse()[0];
}

/** Rows as match_claims returns them, plus the subject's display name. */
export function toClaimHits(
  rows: Array<Record<string, unknown>>,
  nameFor: (subjectType: string, subjectId: string | null) => string,
): ClaimHit[] {
  return rows.map((r) => ({
    kind: "claim" as const,
    id: String(r.id),
    subject_type: String(r.subject_type ?? "self"),
    subject_id: (r.subject_id as string | null) ?? null,
    subject: nameFor(String(r.subject_type ?? "self"), (r.subject_id as string | null) ?? null),
    attribute: String(r.attribute ?? ""),
    value: String(r.value ?? ""),
    valid_from: (r.valid_from as string | null) ?? null,
    valid_to: (r.valid_to as string | null) ?? null,
    confidence: (r.confidence as string | null) ?? null,
    cardinality: (r.cardinality as string | null) ?? null,
    review_by: (r.review_by as string | null) ?? null,
    evidence_quote: (r.evidence_quote as string | null) ?? null,
    source_type: (r.source_type as string | null) ?? null,
    source_id: (r.source_id as string | null) ?? null,
    similarity: Number(r.similarity ?? 0),
  }));
}

/**
 * One line per hit, for the text block search_brain returns.
 *
 * The dates are printed because that is the entire advantage a claim has over
 * a note sentence: the reader can see how old the fact is instead of guessing.
 */
export function renderClaimHit(h: ClaimHit): string {
  const parts = [`[claim] ${h.subject} — ${h.attribute}: ${h.value}`];
  const span = h.valid_from || h.valid_to
    ? `${h.valid_from || "always"} to ${h.valid_to || "now"}`
    : "undated";
  parts.push(`    ${span} · ${h.confidence ?? "likely"} · ${Math.round(h.similarity * 100)}% match · id ${h.id}`);
  if (h.stale_since) {
    parts.push(`    NOT CONFIRMED SINCE ${h.stale_since}. Use it, and say when it was last checked.`);
  }
  if (h.conflicts_with?.length) {
    parts.push(`    DISAGREES WITH: ${h.conflicts_with.join(" | ")}. Report every value; do not pick one.`);
  }
  if (h.evidence_quote) parts.push(`    "${h.evidence_quote}"`);
  if (h.source_type === "note" && h.source_id) parts.push(`    from note ${h.source_id}`);
  return parts.join("\n");
}
