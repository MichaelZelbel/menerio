// The label map for the fact store switch (docs/plans/one-fact-store.md, A3).
//
// The switch migration is plain SQL, but two decisions in it belong to
// TypeScript: which attribute an entry label means (normalizeAttribute) and
// where a claim with no entry is shown (placeClaim). Rather than copy them
// into SQL, build-fact-label-map runs this inside Supabase and writes the
// result into the fact_label_map table, which the switch reads.
//
// Pure: labels and attributes in, rows out.

import { isReservedAttribute, normalizeAttribute } from "./claims.ts";
import { placeClaim } from "./fact-placement.ts";

export interface FactLabelMapRow {
  kind: "label" | "attribute";
  key: string;
  attribute: string;
  label: string;
  category_slug: string;
}

/** A reserved attribute (relationships) keeps its words under this key. */
export const RESERVED_FALLBACK_ATTRIBUTE = "relationship-note";
/** A label that normalizes to nothing still needs a key. */
export const EMPTY_FALLBACK_ATTRIBUTE = "note";

export function attributeForLabel(label: string): string {
  const attribute = normalizeAttribute(label);
  if (!attribute) return EMPTY_FALLBACK_ATTRIBUTE;
  return isReservedAttribute(attribute) ? RESERVED_FALLBACK_ATTRIBUTE : attribute;
}

export function buildFactLabelMap(labels: Iterable<string>, attributes: Iterable<string>): FactLabelMapRow[] {
  const rows: FactLabelMapRow[] = [];
  for (const key of new Set(labels)) {
    const attribute = attributeForLabel(key);
    rows.push({ kind: "label", key, attribute, label: key.trim(), category_slug: placeClaim(attribute).categorySlug });
  }
  for (const key of new Set(attributes)) {
    // The slot joins on claims.attribute, so a claim's own key is kept as is.
    const placed = placeClaim(key);
    rows.push({ kind: "attribute", key, attribute: key, label: placed.label, category_slug: placed.categorySlug });
  }
  return rows;
}
