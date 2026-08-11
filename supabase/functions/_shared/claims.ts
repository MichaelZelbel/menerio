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
 * Which existing claims a new claim supersedes: same attribute, still open
 * (or ending after the new one starts). They get a `valid_to`, never a delete.
 */
export function claimsToSupersede(
  existing: Claim[],
  incoming: { attribute: string; valid_from: string | null },
  today: string = todayISO(),
): Claim[] {
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

  const toClose = claimsToSupersede((existing || []) as Claim[], {
    attribute,
    valid_from: input.valid_from ?? null,
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
      source_type: input.source_type || "ai",
      source_id: input.source_id || null,
    })
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  return { claim: data as Claim, superseded: toClose };
}
