/**
 * Dated facts ("claims") — pure helpers shared by the Facts panels.
 *
 * A claim is a fact believed about a subject (the user, a person, or an
 * entity) with a validity period. Facts are never deleted: when a new fact
 * replaces an old one, the old one gets a `valid_to` date. History is the
 * feature.
 *
 * Mirrors supabase/functions/_shared/claims.ts — keep the two in sync.
 */

export type ClaimSubjectType = "self" | "contact" | "entity";
export type ClaimConfidence = "certain" | "likely" | "unsure";
export type ClaimSourceType = "note" | "moment" | "manual" | "ai";
/** one = a second live value is a contradiction. many = several are normal. */
export type ClaimCardinality = "one" | "many";

export interface Claim {
  id: string;
  user_id: string;
  subject_type: ClaimSubjectType;
  subject_id: string | null;
  attribute: string;
  value: string;
  value_json: Record<string, unknown> | null;
  valid_from: string | null;
  valid_to: string | null;
  confidence: ClaimConfidence;
  cardinality: ClaimCardinality;
  /** The sentence this fact came from. Gives search language to match on. */
  evidence_quote: string | null;
  /** When to DOUBT this fact. Prospective; null = never needs re-checking. */
  review_by: string | null;
  source_type: ClaimSourceType | null;
  source_id: string | null;
  created_at: string;
  updated_at: string;
}

/** YYYY-MM-DD for "today" in local time. */
export function todayISO(now: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** A claim is current when it has no end date, or the end date is in the future. */
export function isCurrentClaim(claim: Pick<Claim, "valid_to">, today: string = todayISO()): boolean {
  return !claim.valid_to || claim.valid_to > today;
}

/**
 * Attributes owned by another surface and therefore never rendered in Facts.
 * Relationships live in `contact_relationships` with their own canonical
 * labels, inverse pairs and rejection ledger — duplicating them here would
 * fork the truth.
 */
export const RESERVED_CLAIM_ATTRIBUTES = new Set(["relationship"]);

export function isReservedAttribute(attribute: string): boolean {
  return RESERVED_CLAIM_ATTRIBUTES.has(normalizeAttribute(attribute));
}

/** Open vocabulary, but stored consistently: lowercase, dash-separated. */
export function normalizeAttribute(attribute: string): string {
  return String(attribute || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-");
}

/** "employer" -> "Employer", "lives-in" -> "Lives in" */
export function humanizeAttribute(attribute: string): string {
  const words = String(attribute || "").replace(/[-_]+/g, " ").trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * Attributes that legitimately hold several live values at once.
 *
 * Everything not listed holds exactly one, which is the safe default: a
 * wrongly-single attribute produces a question for the user, while a
 * wrongly-many one hides a real contradiction and nobody ever finds out.
 *
 * Keys are the output of normalizeAttribute, so they are hyphenated.
 */
export const MANY_VALUED_ATTRIBUTES = new Set([
  "favorite-restaurants",
  "favorite-colors",
  "favorite-animals",
  "favorite-pokemon",
  "favorite-pokémon",
  "favorite-games",
  "investments",
  "pets",
  "hobbies",
  "languages",
  "symptoms",
  "life-events",
  "health-conditions",
  "skills",
  "email",
  "social-handle",
]);

export function cardinalityFor(attribute: string): ClaimCardinality {
  return MANY_VALUED_ATTRIBUTES.has(normalizeAttribute(attribute)) ? "many" : "one";
}

/**
 * How long a fact of this kind stays trustworthy without being looked at.
 * null = never needs re-checking.
 *
 * The PROSPECTIVE half of the model. `valid_to` says when a fact stopped
 * being true, which you only learn afterwards. `review_by` says when to
 * doubt it, which is knowable from the kind of fact when you write it.
 */
export const NEVER_REVIEW_ATTRIBUTES = new Set([
  "date-of-birth",
  "birthplace",
  "wedding-date",
  "gender",
  "ethnicity",
  "full-name",
  "nationality",
  "pronouns",
]);

export const REVIEW_DAYS_BY_ATTRIBUTE: Record<string, number> = {
  "duolingo-streak": 14,
  "body-weight": 14,
  "fitness-goal": 90,
  "health-status": 90,
  "health-conditions": 90,
  "symptoms": 30,
  "line-manager": 180,
  "manager-in-project": 180,
  "manager": 180,
  "job-title": 365,
  "employer": 365,
  "current-city": 365,
  "current-street": 365,
  "location": 365,
  "phone": 730,
  "website": 730,
};

export const DEFAULT_REVIEW_DAYS = 365;

export function reviewDaysFor(attribute: string): number | null {
  const n = normalizeAttribute(attribute);
  if (NEVER_REVIEW_ATTRIBUTES.has(n)) return null;
  return REVIEW_DAYS_BY_ATTRIBUTE[n] ?? DEFAULT_REVIEW_DAYS;
}

/** The date this fact should next be doubted, or null if it never needs it. */
export function reviewByFor(attribute: string, validFrom: string | null): string | null {
  if (!validFrom) return null;
  const days = reviewDaysFor(attribute);
  if (days === null) return null;
  const d = new Date(validFrom + "T00:00:00Z");
  if (Number.isNaN(d.getTime())) return null;
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** True when this fact has not been checked since its review date passed. */
export function isStale(
  claim: { review_by?: string | null; valid_to?: string | null },
  today: string = todayISO(),
): boolean {
  if (!claim.review_by) return false;
  if (claim.valid_to && claim.valid_to <= today) return false; // already closed
  return claim.review_by <= today;
}

function formatDate(value: string): string {
  // Dates are plain YYYY-MM-DD; show the year alone when it's a Jan-1 stub.
  const [y, m, d] = value.split("-");
  if (!m || !d) return value;
  if (m === "01" && d === "01") return y;
  const dt = new Date(`${value}T00:00:00`);
  if (Number.isNaN(dt.getTime())) return value;
  return dt.toLocaleDateString(undefined, { year: "numeric", month: "short" });
}

/** "since 2023", "2021 to 2024", "until 2025", or "" when undated. */
export function formatValidityRange(
  claim: Pick<Claim, "valid_from" | "valid_to">,
  today: string = todayISO(),
): string {
  const from = claim.valid_from ? formatDate(claim.valid_from) : null;
  const to = claim.valid_to ? formatDate(claim.valid_to) : null;
  if (from && to) return `${from} to ${to}`;
  if (from) return isCurrentClaim(claim, today) ? `since ${from}` : `from ${from}`;
  if (to) return `until ${to}`;
  return "";
}

/** Sort current claims by attribute, then most recently started first. */
export function sortClaims(claims: Claim[]): Claim[] {
  return [...claims].sort((a, b) => {
    const attr = a.attribute.localeCompare(b.attribute);
    if (attr !== 0) return attr;
    return (b.valid_from || b.created_at).localeCompare(a.valid_from || a.created_at);
  });
}

/**
 * Which existing claims a new claim supersedes: same attribute, still open
 * (or ending after the new one starts). They get a `valid_to`, never a delete.
 */
export function claimsToSupersede(
  existing: Claim[],
  incoming: { attribute: string; valid_from: string | null; cardinality?: ClaimCardinality },
  today: string = todayISO(),
): Claim[] {
  // A many-valued attribute holds several live values at once, so a new one
  // supersedes nothing. Before cardinality existed, adding a second favourite
  // restaurant silently closed the first, which is a delete wearing a date.
  const cardinality = incoming.cardinality ?? cardinalityFor(incoming.attribute);
  if (cardinality === "many") return [];

  const attribute = normalizeAttribute(incoming.attribute);
  const start = incoming.valid_from || today;
  return existing.filter(
    (c) =>
      normalizeAttribute(c.attribute) === attribute &&
      (!c.valid_to || c.valid_to > start),
  );
}

/** The end date to stamp on a superseded claim. */
export function supersedeDate(incoming: { valid_from: string | null }, today: string = todayISO()): string {
  return incoming.valid_from || today;
}

/** Claims whose validity started or ended within the last `days` days. */
export function changedRecently(claims: Claim[], days = 90, now: Date = new Date()): Claim[] {
  const cutoff = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
  const cutoffISO = todayISO(cutoff);
  return claims.filter(
    (c) =>
      (c.valid_from && c.valid_from >= cutoffISO && c.valid_from <= todayISO(now)) ||
      (c.valid_to && c.valid_to >= cutoffISO && c.valid_to <= todayISO(now)),
  );
}
