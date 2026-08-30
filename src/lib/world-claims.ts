/**
 * Grouping for the World screen's claim list.
 *
 * Several values of one attribute can be true at once. Michael has more than
 * one current email address, so this never picks a winner and never hides a
 * loser. It puts the value a human chose on top and keeps every machine's
 * disagreement visible underneath it, which is the only way a reader can tell
 * a fact he stated from a guess a machine made.
 */

export interface ClaimRow {
  id: string;
  subject_kind: string;
  subject_id: string | null;
  category: string | null;
  attribute: string;
  value: string;
  object_id?: string | null;
  valid_from?: string | null;
  valid_to?: string | null;
  origin: string;
  rank: string;
  evidence_quote?: string | null;
  updated_at?: string | null;
  source_table?: string;
  /** one = a second live value is a contradiction. many = several are normal. */
  cardinality?: string | null;
  /** When to DOUBT this fact, as opposed to when it stopped being true. */
  review_by?: string | null;
  /** note | moment | manual | ai. Says what source_ref points at. */
  source_kind?: string | null;
  /** The note this fact came from, when source_kind is 'note'. */
  source_ref?: string | null;
}

/**
 * A fact nobody has checked since its review date passed.
 *
 * This is the rot no contradiction check can see: one value, nothing
 * disagreeing with it, quietly out of date. A closed claim is history rather
 * than rot, so it never counts.
 */
export function isStale(
  row: Pick<ClaimRow, "review_by" | "valid_to">,
  today = new Date(),
): boolean {
  if (!row.review_by) return false;
  const day = today.toISOString().slice(0, 10);
  if (row.valid_to && row.valid_to <= day) return false;
  return row.review_by <= day;
}

export interface ClaimGroup {
  key: string;
  subject_kind: string;
  subject_id: string | null;
  attribute: string;
  category: string | null;
  /** What the screen shows first. A human's value when there is one. */
  top: ClaimRow;
  /** Everything else believed about the same thing, newest first. */
  others: ClaimRow[];
  /** True when a machine holds a different value from the one on top. */
  disagreed: boolean;
}

export function isHumanWritten(row: Pick<ClaimRow, "origin" | "rank">): boolean {
  return row.origin === "user_manual" || row.rank === "preferred";
}

/** A claim that has stopped being true still belongs in the history. */
export function isCurrent(row: Pick<ClaimRow, "valid_to">, today = new Date()): boolean {
  if (!row.valid_to) return true;
  return new Date(row.valid_to).getTime() >= today.getTime();
}

function sortKey(row: ClaimRow): number {
  return row.updated_at ? new Date(row.updated_at).getTime() : 0;
}

export function groupClaims(rows: ClaimRow[]): ClaimGroup[] {
  const buckets = new Map<string, ClaimRow[]>();

  for (const row of rows) {
    const key = [
      row.subject_kind,
      row.subject_id ?? "self",
      (row.attribute || "").trim().toLowerCase(),
    ].join("|");
    const bucket = buckets.get(key);
    if (bucket) bucket.push(row);
    else buckets.set(key, [row]);
  }

  const groups: ClaimGroup[] = [];
  for (const [key, bucket] of buckets) {
    const ordered = [...bucket].sort((a, b) => {
      const humanDiff = Number(isHumanWritten(b)) - Number(isHumanWritten(a));
      if (humanDiff !== 0) return humanDiff;
      return sortKey(b) - sortKey(a);
    });
    const [top, ...others] = ordered;
    groups.push({
      key,
      subject_kind: top.subject_kind,
      subject_id: top.subject_id,
      attribute: top.attribute,
      category: top.category,
      top,
      others,
      disagreed: others.some(
        (o) => o.value.trim().toLowerCase() !== top.value.trim().toLowerCase(),
      ),
    });
  }

  return groups.sort((a, b) => {
    const attr = a.attribute.localeCompare(b.attribute);
    if (attr !== 0) return attr;
    return a.key.localeCompare(b.key);
  });
}
