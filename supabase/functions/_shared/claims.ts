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

export function isCurrentClaim(claim: Pick<Claim, "valid_to">, today: string = todayISO()): boolean {
  return !claim.valid_to || claim.valid_to > today;
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
 * Attributes that legitimately hold several live values at once.
 *
 * Everything not listed holds exactly one, which is the safe default: a
 * wrongly-single attribute produces a question for the user, while a
 * wrongly-many one hides a real contradiction and nobody ever finds out.
 *
 * Keys are the output of normalizeAttribute, so they are hyphenated.
 * Measured on the hub mirror 2026-08-30: of 8 subject+attribute collisions,
 * at least two were legitimate multi-value attributes rather than
 * contradictions, which is why this list exists before any conflict check.
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
    (c) => normalizeAttribute(c.attribute) === attribute && (!c.valid_to || c.valid_to > start),
  );
}

/** The end date to stamp on a superseded claim. */
export function supersedeDate(incoming: { valid_from: string | null }, today: string = todayISO()): string {
  return incoming.valid_from || today;
}

/** Claims whose validity started or ended within the last `days` days. */
export function changedSince(claims: Claim[], sinceISO: string): Claim[] {
  return claims.filter(
    (c) => (c.valid_from && c.valid_from >= sinceISO) || (c.valid_to && c.valid_to >= sinceISO),
  );
}

export function sortClaims(claims: Claim[]): Claim[] {
  return [...claims].sort((a, b) => {
    const attr = a.attribute.localeCompare(b.attribute);
    if (attr !== 0) return attr;
    return (b.valid_from || b.created_at).localeCompare(a.valid_from || a.created_at);
  });
}

export interface AddClaimInput {
  user_id: string;
  subject_type: ClaimSubjectType;
  subject_id: string | null;
  attribute: string;
  value: string;
  valid_from?: string | null;
  valid_to?: string | null;
  confidence?: ClaimConfidence;
  /** Defaults from the attribute when omitted. */
  cardinality?: ClaimCardinality;
  evidence_quote?: string | null;
  /** Defaults from the attribute and valid_from when omitted. */
  review_by?: string | null;
  source_type?: ClaimSourceType;
  source_id?: string | null;
}

/**
 * Insert a claim, auto-closing any overlapping open claim on the same
 * subject + attribute. Never deletes.
 */
export async function addClaimWithSupersede(
  supabase: any,
  input: AddClaimInput,
): Promise<{ claim: Claim; superseded: Claim[] }> {
  const attribute = normalizeAttribute(input.attribute);
  if (!attribute) throw new Error("An attribute is required");
  if (isReservedAttribute(attribute)) {
    throw new Error(
      "Relationships are not claims. Use the relationship tools (contact_relationships) so canonical labels, inverses and the rejection ledger stay authoritative.",
    );
  }
  const value = String(input.value || "").trim();
  if (!value) throw new Error("A value is required");

  let q = supabase
    .from("claims")
    .select("*")
    .eq("user_id", input.user_id)
    .eq("subject_type", input.subject_type)
    .eq("attribute", attribute);
  q = input.subject_type === "self" ? q.is("subject_id", null) : q.eq("subject_id", input.subject_id);
  const { data: existing, error: existingError } = await q;
  if (existingError) throw new Error(existingError.message);

  const cardinality = input.cardinality ?? cardinalityFor(attribute);

  const toClose = claimsToSupersede((existing || []) as Claim[], {
    attribute,
    valid_from: input.valid_from ?? null,
    cardinality,
  });
  const endDate = supersedeDate({ valid_from: input.valid_from ?? null });
  for (const claim of toClose) {
    const { error } = await supabase.from("claims").update({ valid_to: endDate }).eq("id", claim.id);
    if (error) throw new Error(error.message);
  }

  const { data, error } = await supabase
    .from("claims")
    .insert({
      user_id: input.user_id,
      subject_type: input.subject_type,
      subject_id: input.subject_type === "self" ? null : input.subject_id,
      attribute,
      value,
      valid_from: input.valid_from || null,
      valid_to: input.valid_to || null,
      confidence: input.confidence || "likely",
      cardinality,
      evidence_quote: input.evidence_quote || null,
      review_by: input.review_by ?? reviewByFor(attribute, input.valid_from ?? null),
      source_type: input.source_type || "ai",
      source_id: input.source_id || null,
    })
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  return { claim: data as Claim, superseded: toClose };
}
