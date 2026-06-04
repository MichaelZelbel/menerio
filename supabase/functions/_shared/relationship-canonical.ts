// Shared canonicalization + symmetry helpers for contact_relationships.
// Used by edge functions to canonicalize relationship labels, detect symmetric
// labels (spouse, partner, friend, …), and produce a direction-independent
// pair key for dedup so we never get two opposite-direction rows describing the
// same fact.

export type EntityRef = {
  type: "contact" | "self";
  id: string | null; // null when type === "self"
};

// Canonical label vocabulary. Anything not in this map keeps its lowercase form.
const LABEL_CANONICAL: Record<string, string> = {
  // Marriage / partnership
  wife: "spouse",
  husband: "spouse",
  spouse: "spouse",
  married: "spouse",
  marriage: "spouse",
  "life partner": "spouse",
  ehefrau: "spouse",
  ehemann: "spouse",
  ehepartner: "spouse",
  // Romantic but not married
  partner: "partner",
  girlfriend: "partner",
  boyfriend: "partner",
  fiance: "partner",
  fiancee: "partner",
  // Lover stays as its own label — explicit, non-canonical to spouse/partner
  lover: "lover",
  // Family
  mom: "mother",
  mum: "mother",
  mama: "mother",
  mother: "mother",
  dad: "father",
  papa: "father",
  father: "father",
  parent: "parent",
  child: "child",
  son: "son",
  daughter: "daughter",
  brother: "brother",
  sister: "sister",
  sibling: "sibling",
  // Social / work
  friend: "friend",
  bestfriend: "friend",
  "best friend": "friend",
  buddy: "friend",
  coworker: "co-worker",
  "co-worker": "co-worker",
  colleague: "co-worker",
  neighbor: "neighbor",
  neighbour: "neighbor",
  roommate: "roommate",
  flatmate: "roommate",
  // Work hierarchy (asymmetric — keep as-is)
  manager: "manager",
  report: "report",
  employee: "employee",
  employer: "employer",
  mentor: "mentor",
  mentee: "mentee",
  teacher: "teacher",
  student: "student",
  client: "client",
  provider: "provider",
};

// Labels that mean the same thing in both directions. A spouse B ⇔ B spouse A.
const SYMMETRIC_LABELS = new Set<string>([
  "spouse",
  "partner",
  "lover",
  "friend",
  "sibling",
  "co-worker",
  "neighbor",
  "roommate",
]);

// When the model returns an asymmetric pair, we use this to find the inverse.
const INVERSE_LABEL: Record<string, string> = {
  mother: "child",
  father: "child",
  parent: "child",
  child: "parent",
  son: "parent",
  daughter: "parent",
  brother: "sibling",
  sister: "sibling",
  employer: "employee",
  employee: "employer",
  manager: "report",
  report: "manager",
  mentor: "mentee",
  mentee: "mentor",
  teacher: "student",
  student: "teacher",
  client: "provider",
  provider: "client",
};

export function canonicalLabel(label: string | null | undefined): string {
  const lower = String(label || "").trim().toLowerCase();
  if (!lower) return "";
  return LABEL_CANONICAL[lower] || lower;
}

export function isSymmetricLabel(label: string): boolean {
  return SYMMETRIC_LABELS.has(canonicalLabel(label));
}

export function inverseLabel(label: string): string {
  const c = canonicalLabel(label);
  if (isSymmetricLabel(c)) return c;
  return INVERSE_LABEL[c] || c;
}

function refKey(ref: EntityRef): string {
  return `${ref.type}:${ref.id || "self"}`;
}

/**
 * Direction-independent pair key for symmetric labels, direction-aware for
 * asymmetric labels. Pass userId so keys are unique per user.
 */
export function relationshipPairKey(
  userId: string,
  a: EntityRef,
  b: EntityRef,
  label: string,
): string {
  const c = canonicalLabel(label);
  if (isSymmetricLabel(c)) {
    const [x, y] = [refKey(a), refKey(b)].sort();
    return `${userId}|sym|${c}|${x}|${y}`;
  }
  return `${userId}|dir|${c}|${refKey(a)}|${refKey(b)}`;
}

/**
 * Returns true if two stored/proposed relationships are semantically equivalent.
 */
export function relationshipsEquivalent(
  userId: string,
  a1: EntityRef, b1: EntityRef, l1: string,
  a2: EntityRef, b2: EntityRef, l2: string,
): boolean {
  return relationshipPairKey(userId, a1, b1, l1) === relationshipPairKey(userId, a2, b2, l2);
}

// Common self-aliases. Matched case-insensitively against extracted names.
const BASE_SELF_ALIASES = ["me", "myself", "i", "my", "mine"];

export function buildSelfAliases(extra: Array<string | null | undefined> = []): Set<string> {
  const set = new Set<string>(BASE_SELF_ALIASES);
  for (const name of extra) {
    const n = String(name || "").trim().toLowerCase();
    if (n) set.add(n);
  }
  return set;
}

export function isSelfName(name: string, selfAliases: Set<string>): boolean {
  return selfAliases.has(String(name || "").trim().toLowerCase());
}
