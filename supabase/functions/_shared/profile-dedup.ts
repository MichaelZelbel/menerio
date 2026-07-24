// Token-aware duplicate guard shared by profile-entry extractors
// (`process-note` and `moment-profile-extraction`). The old dedup keyed on
// `(contact_id, label_lower, normalized_value)` — exact string match. That
// let list-valued facts regenerate as duplicates whenever a note reshuffled
// the tokens ("MDD, BPD, ASD" vs "MDD, BPD, ASD, panic attacks"). This
// module:
//   1) canonicalizes the incoming label,
//   2) detects list-valued labels via the canonical schema,
//   3) splits list values into tokens, and
//   4) skips writes whose tokens are all already present, or rewrites the
//      suggestion's `value` to just the residual (genuinely new) tokens.
//
// Non-list labels keep the existing exact-compare + singleton behavior.

import {
  canonicalProfileLabel,
  isListValuedLabel,
  isSingleValueLabel,
  normalizeProfileValueForDedup,
  stripTrailingQualifier,
} from "./profile-canonical-schema.ts";

// Inlined copies of `splitListTokens` / `normalizeTokenForList` from
// `profile-normalization.ts`. That module transitively imports Deno-only
// code (llm-router → llm-credits), which breaks Vitest when the frontend
// imports helpers from here. Keep these two in sync manually if the source
// implementations change.
function normalizeTokenForList(label: string, token: string): { key: string; display: string } {
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

function splitListTokens(label: string, value: string): Array<{ key: string; display: string }> {
  return String(value || "")
    .replace(/^allergic\s+to\s+/i, "")
    .split(/[,;\/]|\band\b|\bund\b|\balso\b|\bor\b|\boder\b/i)
    .map((t) => normalizeTokenForList(label, t))
    .filter((t) => t.display.length > 0 && t.key.length > 0);
}

const OWNER = "__owner__";

export type ExistingProfileRecord = {
  contact_id: string | null | undefined;
  label: string;
  value: string;
};

function contactKey(cid: string | null | undefined): string {
  return cid ?? OWNER;
}

// Best-effort canonicalization from label alone. `canonicalProfileLabel` with
// an unknown slug falls through to the GLOBAL_ALIAS_MAP, which resolves both
// structured aliases ("birthday" → "Date of birth") and OPEN_CATEGORY_LABEL_
// ALIASES ("favorite foods" → "Favorite food").
function canonLabel(label: string): string {
  return canonicalProfileLabel("", label);
}

// Group labels that describe the SAME set of tokens across DIFFERENT label
// strings so incoming tokens can't silently duplicate existing ones simply
// because the extractor used a slightly different label name. Kept narrow:
// only the two families we've actually observed duplicating in real data.
const FOOD_FAVORITE_LABELS = new Set(
  [
    "favorite food",
    "favorite drink",
    "favorite dessert",
    "favorite restaurant",
    "favorite restaurants",
    "favorite fast food",
    "favorite cuisine",
    "favorite cuisines",
    "favorite dish",
    "favorite dishes",
  ].map((s) => s.toLowerCase()),
);

function bucketsFor(
  cid: string | null | undefined,
  canonicalLabel: string,
  tokens?: Array<{ key: string }>,
): string[] {
  const ck = contactKey(cid);
  const cl = canonicalLabel.toLowerCase();
  const out = [`${ck}||label:${cl}`];
  if (FOOD_FAVORITE_LABELS.has(cl)) out.push(`${ck}||group:food-favorite`);
  const isAllergyLabel = cl === "allergies" || cl === "allergy";
  const hasAllergyToken = tokens?.some((t) => /allerg/.test(t.key)) ?? false;
  if (isAllergyLabel || hasAllergyToken) out.push(`${ck}||group:allergy`);
  return out;
}

export type TokenIndex = {
  // Bucket → set of normalized token keys (for list labels) or normalized
  // value strings (for non-list labels, kept in a per-label bucket for
  // completeness even though we compare via `exact` below).
  tokens: Map<string, Set<string>>;
  // "cid|label_lower|norm_value" — exact match for non-list labels.
  exact: Set<string>;
  // "cid|canonical_label_lower" — non-list singleton labels already claimed.
  singleton: Set<string>;
};

export function buildProfileTokenIndex(
  entries: ReadonlyArray<ExistingProfileRecord>,
  queue: ReadonlyArray<ExistingProfileRecord>,
): TokenIndex {
  const idx: TokenIndex = {
    tokens: new Map(),
    exact: new Set(),
    singleton: new Set(),
  };

  const add = (r: ExistingProfileRecord) => {
    const cid = r.contact_id ?? null;
    const label = String(r.label || "");
    const value = String(r.value || "");
    if (!label || !value) return;
    const cl = canonLabel(label);
    const clLower = cl.toLowerCase();
    const ck = contactKey(cid);

    idx.exact.add(
      `${ck}|${label.toLowerCase()}|${normalizeProfileValueForDedup(value)}`,
    );

    if (isListValuedLabel(cl)) {
      const toks = splitListTokens(cl, value);
      const bs = bucketsFor(cid, cl, toks);
      for (const b of bs) {
        let s = idx.tokens.get(b);
        if (!s) {
          s = new Set();
          idx.tokens.set(b, s);
        }
        for (const t of toks) s.add(t.key);
      }
    } else {
      if (isSingleValueLabel(cl)) idx.singleton.add(`${ck}|${clLower}`);
    }
  };

  for (const r of entries) add(r);
  for (const r of queue) add(r);
  return idx;
}

export type DedupResult =
  | { action: "skip"; reason: string }
  | { action: "write"; value: string };

/**
 * Decide whether an incoming (contact, label, value) suggestion should be
 * written. Mutates `index` when the write is permitted so subsequent calls
 * in the same batch dedup against the freshly-added tokens.
 */
export function dedupIncomingProfileValue(args: {
  contactId: string | null | undefined;
  label: string;
  value: string;
  index: TokenIndex;
}): DedupResult {
  const cid = args.contactId ?? null;
  const label = String(args.label || "").trim();
  const value = String(args.value || "").trim();
  if (!label || !value) return { action: "skip", reason: "empty" };

  const cl = canonLabel(label);
  const clLower = cl.toLowerCase();
  const ck = contactKey(cid);

  // Non-list labels: exact-compare (backwards-compatible) + singleton guard.
  if (!isListValuedLabel(cl)) {
    const exactKey = `${ck}|${label.toLowerCase()}|${normalizeProfileValueForDedup(value)}`;
    if (args.index.exact.has(exactKey)) return { action: "skip", reason: "exact_duplicate" };
    if (isSingleValueLabel(cl) && args.index.singleton.has(`${ck}|${clLower}`)) {
      return { action: "skip", reason: "singleton_taken" };
    }
    args.index.exact.add(exactKey);
    if (isSingleValueLabel(cl)) args.index.singleton.add(`${ck}|${clLower}`);
    return { action: "write", value };
  }

  // List labels: split → drop known tokens → skip or rewrite.
  const toks = splitListTokens(cl, value);
  if (toks.length === 0) return { action: "skip", reason: "no_tokens" };

  const buckets = bucketsFor(cid, cl, toks);
  const known = new Set<string>();
  for (const b of buckets) {
    const s = args.index.tokens.get(b);
    if (!s) continue;
    for (const t of toks) if (s.has(t.key)) known.add(t.key);
  }

  // Keep first-occurrence order + drop residual dupes within the incoming
  // value itself (e.g. "KFC, KFC").
  const residual: Array<{ key: string; display: string }> = [];
  const seen = new Set<string>();
  for (const t of toks) {
    if (known.has(t.key) || seen.has(t.key)) continue;
    seen.add(t.key);
    residual.push(t);
  }
  if (residual.length === 0) return { action: "skip", reason: "all_tokens_known" };

  for (const b of buckets) {
    let s = args.index.tokens.get(b);
    if (!s) {
      s = new Set();
      args.index.tokens.set(b, s);
    }
    for (const t of residual) s.add(t.key);
  }

  const newValue = residual.map((t) => t.display).join(", ");
  return { action: "write", value: newValue };
}
