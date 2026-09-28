// How one legacy bag splits (split-legacy-bags; docs/plans/one-fact-store.md, B6). Pure.

import { gateStoredValue } from "./profile-fact-gate.ts";
import { isReservedAttribute, normalizeAttribute } from "./claims.ts";

export interface BagRow {
  attribute: string;
  value: string;
  origin: string;
  rank: string;
  label: string;
  category_slug: string | null;
}

export type BagPlan =
  | { kind: "split"; pieces: Array<{ attribute: string; label: string; category_slug: string; value: string }> }
  | { kind: "keep_human" }
  | { kind: "keep_one_fact" }
  | { kind: "keep_unfileable" };

export function planBagSplit(row: BagRow): BagPlan {
  if (row.rank === "preferred" || row.origin === "user_manual") return { kind: "keep_human" };
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
