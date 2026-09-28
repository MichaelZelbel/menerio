// How one legacy bag splits (split-legacy-bags; docs/plans/one-fact-store.md, B6). Pure.

import { gateStoredValue } from "./profile-fact-gate.ts";
import { isReservedAttribute, normalizeAttribute } from "./claims.ts";
import { selectAllRows } from "./paged-select.ts";

export interface BagRow {
  attribute: string;
  value: string;
  origin: string;
  rank: string;
  label: string;
  category_slug: string | null;
  /** The section's scope, from profile_facts. */
  visibility_scope?: string | null;
}

export type BagPlan =
  | { kind: "split"; pieces: Array<{ attribute: string; label: string; category_slug: string; value: string }> }
  | { kind: "keep_human" }
  | { kind: "keep_private" }
  | { kind: "keep_one_fact" }
  | { kind: "keep_unfileable" };

export function planBagSplit(row: BagRow): BagPlan {
  if (row.rank === "preferred" || row.origin === "user_manual") return { kind: "keep_human" };
  // The splitter files pieces by their own kind (an email under Communication,
  // a diagnosis under Health), and a piece may join a slot that already sits in
  // a public section. Either would show a private fact to assistants.
  if (row.visibility_scope === "private") return { kind: "keep_private" };
  const routed = gateStoredValue({ label: row.label, categorySlug: row.category_slug ?? "preferences", value: row.value });
  if (routed.length < 2) return { kind: "keep_one_fact" };
  if (routed.some((r) => !r.accepted)) return { kind: "keep_unfileable" };
  const pieces = routed.map((r) => {
    const attribute = normalizeAttribute(r.label);
    // A piece filed under the bag's own label keeps the bag's attribute key.
    const own = normalizeAttribute(row.label) === attribute;
    return { attribute: own ? row.attribute : attribute, label: r.label, category_slug: r.categorySlug, value: r.value.trim() };
  });
  if (pieces.some((p) => !p.attribute || !p.value || isReservedAttribute(p.attribute))) return { kind: "keep_unfileable" };
  return { kind: "split", pieces };
}

/**
 * Every live fact whose value holds a comma or a semicolon. Two plain filters,
 * not one `or`: PostgREST splits an `or` list on commas, so
 * `value.like.%,%` inside it does not parse.
 */
export async function loadBagCandidates(db: any): Promise<Array<BagRow & { claim_id: string; user_id: string; subject_type: string; subject_id: string | null }>> {
  const columns = "claim_id, user_id, subject_type, subject_id, attribute, value, origin, rank, label, category_slug, visibility_scope";
  const byId = new Map<string, any>();
  for (const pattern of ["%,%", "%;%"]) {
    const rows = await selectAllRows<any>((from, to) =>
      db.from("profile_facts").select(columns).is("valid_to", null).like("value", pattern).order("claim_id").range(from, to));
    for (const r of rows) byId.set(r.claim_id, r);
  }
  return [...byId.values()].sort((a, b) => String(a.claim_id).localeCompare(String(b.claim_id)));
}
