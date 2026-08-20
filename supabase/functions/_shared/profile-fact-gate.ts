/**
 * The admission gate for profile facts.
 *
 * Before this module existed, a profile row was a bag: every writer merged new
 * material into an existing row with `join(", ")`, so rows only ever grew and
 * nothing could be corrected at fact level. Worse, nothing checked that a fact
 * belonged under its label, so an email address, an occupation and a TV show
 * all ended up inside "Full name".
 *
 * This module enforces two rules for every fact, wherever it comes from:
 *
 *   1. ATOMICITY — one row holds one claim. `splitToFacts()` explodes a
 *      multi-fact string into candidate atomic facts.
 *   2. LABEL FIT — the fact must be a plausible instance of its label's type.
 *      `typeOfValue()` classifies the value deterministically and
 *      `labelAcceptsType()` decides. A mismatch is re-routed by `routeFact()`
 *      when the type names a target label unambiguously, and refused
 *      otherwise — never written to the wrong label "to be cleaned later".
 *
 * Deliberately deterministic and dependency-free (no Deno-only imports) so the
 * frontend can mirror it via `src/lib/profile-fact-gate.ts`.
 */

import {
  canonicalProfileLabel,
  correctProfileCategory,
} from "./profile-canonical-schema.ts";

export type FactType =
  | "email"
  | "url"
  | "phone"
  | "handle"
  | "identifier"
  | "date"
  | "measure"
  | "money"
  | "person_name"
  | "phrase"
  | "sentence";

/** Values longer than this can never be a single atomic fact. */
export const FACT_MAX_LENGTH = 240;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i;
const URL_RE = /^(https?:\/\/|www\.)\S+$/i;
const DOMAIN_RE = /^[a-z0-9-]+(\.[a-z0-9-]+)+(\/\S*)?$/i;
const PHONE_RE = /^\+?[\d][\d\s().-]{6,}$/;
const HANDLE_RE = /^@[\w.-]{2,}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SNOWFLAKE_RE = /^\d{15,25}$/;
const MEASURE_RE = /^\d+([.,]\d+)?\s?(cm|m|mm|kg|g|lb|lbs|ft|in|")$/i;
const MONEY_RE = /^[$€£¥]\s?\d/;
const DATE_RE =
  /^(\d{4}-\d{2}-\d{2}|\d{1,2}[./]\d{1,2}[./]\d{2,4}|(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+\d{1,2},?\s*(\d{4})?|\d{1,2}\.?\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s*(\d{4})?)$/i;
const PERSON_NAME_RE = /^[\p{L}][\p{L}'’.-]*(\s+[\p{L}][\p{L}'’.-]*){0,4}$/u;

/** A value carrying its own inline label, e.g. "Occupation: System Analyst". */
export const EMBEDDED_LABEL_RE = /^\s*([\p{L}][\p{L} /-]{2,30}?)\s*:\s*(\S.*)$/u;

export function typeOfValue(raw: string): FactType {
  const v = String(raw || "").trim();
  if (!v) return "phrase";
  if (EMAIL_RE.test(v)) return "email";
  if (URL_RE.test(v) || DOMAIN_RE.test(v)) return "url";
  if (HANDLE_RE.test(v)) return "handle";
  if (UUID_RE.test(v) || SNOWFLAKE_RE.test(v)) return "identifier";
  if (PHONE_RE.test(v)) return "phone";
  if (MEASURE_RE.test(v)) return "measure";
  if (MONEY_RE.test(v)) return "money";
  if (DATE_RE.test(v)) return "date";
  const words = v.split(/\s+/).length;
  if (words > 6 || /[.!?;:]\s/.test(v)) return "sentence";
  if (PERSON_NAME_RE.test(v) && words <= 4) return "person_name";
  return "phrase";
}

/**
 * Types a canonical label will accept. `null` = the label is free-form and
 * accepts anything short enough to be one fact (open categories, traits,
 * favorites …). Only labels with a genuinely constrained shape are listed —
 * over-listing would reject valid facts.
 */
const LABEL_TYPE_EXPECTATIONS: Record<string, FactType[]> = {
  "full name": ["person_name"],
  "preferred name": ["person_name"],
  "maiden name": ["person_name"],
  "married surname": ["person_name"],
  "nickname": ["person_name", "phrase", "handle"],
  "date of birth": ["date"],
  "wedding date": ["date"],
  "anniversary": ["date"],
  "graduation year": ["date", "phrase"],
  "email": ["email"],
  "phone": ["phone"],
  "website": ["url"],
  "social handle": ["handle", "url", "identifier", "phrase"],
  "height": ["measure", "phrase"],
  "income": ["money", "phrase"],
  "current city": ["person_name", "phrase"],
  "current country": ["person_name", "phrase"],
  "place of birth": ["person_name", "phrase"],
  "previous city": ["person_name", "phrase"],
  "postal code": ["identifier", "phrase"],
  "pets": ["person_name", "phrase"],
  "gender": ["phrase", "person_name"],
  "pronouns": ["phrase"],
};

/** Where a mismatched value of a given type belongs instead. */
const TYPE_ROUTES: Record<string, { label: string; category: string }> = {
  email: { label: "Email", category: "communication" },
  url: { label: "Website", category: "communication" },
  phone: { label: "Phone", category: "communication" },
  handle: { label: "Social handle", category: "communication" },
  identifier: { label: "Social handle", category: "communication" },
};

export function expectedTypesForLabel(canonicalLabel: string): FactType[] | null {
  return LABEL_TYPE_EXPECTATIONS[String(canonicalLabel || "").trim().toLowerCase()] ?? null;
}

export function labelAcceptsType(canonicalLabel: string, type: FactType): boolean {
  const expected = expectedTypesForLabel(canonicalLabel);
  // Free-form labels (traits, favorites, open categories) accept any type,
  // including prose — atomicity is enforced separately by length + splitting.
  if (!expected) return true;
  return expected.includes(type);
}

const NEVER_SPLIT_LABELS = new Set([
  "professional summary",
  "self description",
  "how we met",
  "bio",
  "note",
  "summary",
]);

/**
 * Explode a stored value into candidate atomic facts.
 *
 * Conservative on purpose: "São Paulo, Brazil" (one separator, short) is ONE
 * fact and must not become two, while "Japanese area in São Paulo, Liberdade,
 * my room" (two separators) is three. Commas inside parentheses never split.
 */
export function splitToFacts(label: string, value: string): string[] {
  const v = String(value || "").trim();
  if (!v) return [];
  if (NEVER_SPLIT_LABELS.has(String(label || "").trim().toLowerCase())) return [v];

  const segments: string[] = [];
  let depth = 0;
  let current = "";
  let separators = 0;
  for (const ch of v) {
    if (ch === "(" || ch === "[") depth++;
    else if (ch === ")" || ch === "]") depth = Math.max(0, depth - 1);
    const isSep = depth === 0 && (ch === "," || ch === ";" || ch === "\n");
    if (isSep) {
      separators++;
      segments.push(current);
      current = "";
      continue;
    }
    current += ch;
  }
  segments.push(current);

  // One short "A, B" stays whole — it is usually a single qualified fact.
  if (separators < 2 && v.length <= 60) return [v];
  if (separators === 0) return [v];

  const out: string[] = [];
  const seen = new Set<string>();
  for (const seg of segments) {
    const s = seg.trim().replace(/^[-–•*]\s*/, "").replace(/[.。]+$/u, "").trim();
    if (!s) continue;
    const key = s.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(s);
  }
  return out.length > 0 ? out : [v];
}

export type RoutedFact = {
  accepted: boolean;
  label: string;
  categorySlug: string;
  value: string;
  type: FactType;
  reason?: string;
};

/**
 * Decide where one atomic fact belongs. Returns the (possibly corrected)
 * label + category, or `accepted: false` when the fact cannot be filed
 * responsibly and must go to review instead of into a wrong row.
 */
export function routeFact(input: {
  label: string;
  categorySlug: string;
  value: string;
}): RoutedFact {
  const rawValue = String(input.value || "").trim();
  let label = String(input.label || "").trim();
  let categorySlug = String(input.categorySlug || "").trim();
  let value = rawValue;

  if (!value || !label) {
    return { accepted: false, label, categorySlug, value, type: "phrase", reason: "empty" };
  }

  // "Occupation: System Analyst" carries its own label — trust it over the
  // bag it happened to be stored in.
  const embedded = EMBEDDED_LABEL_RE.exec(value);
  if (embedded) {
    const embeddedLabel = embedded[1].trim();
    const embeddedValue = embedded[2].trim();
    const canonicalEmbedded = canonicalProfileLabel("", embeddedLabel);
    if (canonicalEmbedded && embeddedValue) {
      label = canonicalEmbedded;
      value = embeddedValue;
      categorySlug = correctProfileCategory(label, categorySlug);
    }
  }

  const canonical = canonicalProfileLabel(categorySlug, label) || label;
  categorySlug = correctProfileCategory(canonical, categorySlug);
  const type = typeOfValue(value);

  if (value.length > FACT_MAX_LENGTH) {
    return { accepted: false, label: canonical, categorySlug, value, type, reason: "not_atomic" };
  }

  if (!labelAcceptsType(canonical, type)) {
    const route = TYPE_ROUTES[type];
    if (route) {
      return {
        accepted: true,
        label: route.label,
        categorySlug: route.category,
        value,
        type,
        reason: "rerouted_by_type",
      };
    }
    return {
      accepted: false,
      label: canonical,
      categorySlug,
      value,
      type,
      reason: `type_mismatch:${type}`,
    };
  }

  return { accepted: true, label: canonical, categorySlug, value, type };
}

/** Convenience: split a stored bag and route every resulting fact. */
export function gateStoredValue(input: {
  label: string;
  categorySlug: string;
  value: string;
}): RoutedFact[] {
  return splitToFacts(input.label, input.value).map((v) =>
    routeFact({ label: input.label, categorySlug: input.categorySlug, value: v }),
  );
}
