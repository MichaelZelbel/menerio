/**
 * Dated facts ("claims") — shared backend helpers.
 *
 * A claim is a fact believed about a subject (the user, a person, or an
 * entity) with a validity period. Facts are never deleted: when a new fact
 * replaces an old one, the old one gets a `valid_to` date.
 *
 * Mirrors src/lib/claims.ts — keep the two in sync.
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

/** YYYY-MM-DD for "today". */
export function todayISO(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

/**
 * Attributes owned by another surface, never stored as claims.
 * Relationships live in `contact_relationships` with their own canonical
 * labels, inverse pairs and rejection ledger.
 */
export const RESERVED_CLAIM_ATTRIBUTES = new Set(["relationship", "relationships", "related-to"]);

export function normalizeAttribute(attribute: string): string {
  return String(attribute || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-");
}

export function isReservedAttribute(attribute: string): boolean {
  return RESERVED_CLAIM_ATTRIBUTES.has(normalizeAttribute(attribute));
}

export function humanizeAttribute(attribute: string): string {
  const words = String(attribute || "").replace(/[-_]+/g, " ").trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * How long a fact of this kind stays trustworthy without being looked at.
 * null = never needs re-checking.
 *
 * This is the PROSPECTIVE half of the model, and it is the part no other
 * agent-memory system has. `valid_to` says when a fact stopped being true,
 * which you only learn afterwards. `review_by` says when to doubt it, which
 * is knowable from the kind of fact at the moment you write it.
 *
 * The case it exists for: a Duolingo streak stamped "as of 2026-07-29",
 * read on 2026-08-30. One value, contradicted by nothing, wrong by 32 days.
 * Every contradiction check ever written is blind to that.
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
  claim: Pick<Claim, "review_by" | "valid_to">,
  today: string = todayISO(),
): boolean {
  if (!claim.review_by) return false;
  if (claim.valid_to && claim.valid_to <= today) return false; // already closed
  return claim.review_by <= today;
}

// Adding a claim is writeFact (fact-store.ts), the one write path
// (docs/plans/one-fact-store.md, 3.5).
