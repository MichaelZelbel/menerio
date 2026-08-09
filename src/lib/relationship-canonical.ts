// Frontend mirror of supabase/functions/_shared/relationship-canonical.ts.
//
// The region between the BEGIN/END SHARED CORE markers is byte-identical with
// that file and is asserted by
// src/lib/__tests__/relationship-canonical-mirror.test.ts. Edit both, or
// neither.

// --- BEGIN SHARED CORE ---
export type EntityRef = {
  type: "contact" | "self";
  id: string | null; // null when type === "self"
};

/**
 * Normalize a raw, possibly LLM-authored label into a lookup key:
 * lowercase, parentheticals dropped ("partner (companion)" → "partner"),
 * slashes treated as separators, punctuation stripped, spaces collapsed.
 */
export function normalizeLabelKey(label: string | null | undefined): string {
  return String(label || "")
    .toLowerCase()
    .replace(/\([^)]*\)/g, " ")
    .replace(/[/|,]+/g, " / ")
    .replace(/[^a-z0-9\u00c0-\u024f/\s-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Canonical label vocabulary. Anything not in this map keeps its normalized form.
const LABEL_CANONICAL: Record<string, string> = {
  // Marriage
  wife: "wife",
  husband: "husband",
  spouse: "spouse",
  married: "spouse",
  "married to": "spouse",
  marriage: "spouse",
  "life partner": "spouse",
  ehefrau: "wife",
  ehemann: "husband",
  ehepartner: "spouse",
  // Romantic but not married — every flavour folds into one edge
  partner: "partner",
  girlfriend: "partner",
  boyfriend: "partner",
  fiance: "partner",
  fiancee: "partner",
  "fiancé": "partner",
  "fiancée": "partner",
  "romantic partner": "partner",
  "intimate partner": "partner",
  "sexual partner": "partner",
  "romantic interest": "partner",
  "love interest": "partner",
  companion: "partner",
  "significant other": "partner",
  freundin: "partner",
  freund: "partner",
  lover: "lover",
  // Family
  mom: "mother",
  mum: "mother",
  mama: "mother",
  mutter: "mother",
  mother: "mother",
  dad: "father",
  papa: "father",
  vater: "father",
  father: "father",
  parent: "parent",
  child: "child",
  kid: "child",
  kids: "child",
  children: "child",
  son: "son",
  daughter: "daughter",
  brother: "brother",
  bruder: "brother",
  sister: "sister",
  schwester: "sister",
  sibling: "sibling",
  // Extended family
  grandmother: "grandmother",
  grandma: "grandmother",
  granny: "grandmother",
  oma: "grandmother",
  grossmutter: "grandmother",
  grandfather: "grandfather",
  grandpa: "grandfather",
  opa: "grandfather",
  grossvater: "grandfather",
  grandparent: "grandparent",
  grandson: "grandson",
  granddaughter: "granddaughter",
  grandchild: "grandchild",
  grandkid: "grandchild",
  aunt: "aunt",
  tante: "aunt",
  uncle: "uncle",
  onkel: "uncle",
  niece: "niece",
  nichte: "niece",
  nephew: "nephew",
  neffe: "nephew",
  cousin: "cousin",
  cousine: "cousin",
  relative: "relative",
  "family member": "relative",
  // Step family
  stepfather: "stepfather",
  "step father": "stepfather",
  stepdad: "stepfather",
  stiefvater: "stepfather",
  stepmother: "stepmother",
  "step mother": "stepmother",
  stepmom: "stepmother",
  stiefmutter: "stepmother",
  stepparent: "stepparent",
  "step parent": "stepparent",
  stiefelternteil: "stepparent",
  stepson: "stepson",
  "step son": "stepson",
  stiefsohn: "stepson",
  stepdaughter: "stepdaughter",
  "step daughter": "stepdaughter",
  stieftochter: "stepdaughter",
  stepchild: "stepchild",
  "step child": "stepchild",
  stepbrother: "stepbrother",
  "step brother": "stepbrother",
  stepsister: "stepsister",
  "step sister": "stepsister",
  stepsibling: "stepsibling",
  // In-laws
  "father-in-law": "father-in-law",
  "father in law": "father-in-law",
  schwiegervater: "father-in-law",
  "mother-in-law": "mother-in-law",
  "mother in law": "mother-in-law",
  schwiegermutter: "mother-in-law",
  "parent-in-law": "parent-in-law",
  "parent in law": "parent-in-law",
  "son-in-law": "son-in-law",
  "son in law": "son-in-law",
  "daughter-in-law": "daughter-in-law",
  "daughter in law": "daughter-in-law",
  "child-in-law": "child-in-law",
  "brother-in-law": "brother-in-law",
  "brother in law": "brother-in-law",
  schwager: "brother-in-law",
  "sister-in-law": "sister-in-law",
  "sister in law": "sister-in-law",
  "sibling-in-law": "sibling-in-law",
  // Chosen family
  godfather: "godfather",
  godmother: "godmother",
  godparent: "godparent",
  godson: "godson",
  goddaughter: "goddaughter",
  godchild: "godchild",
  guardian: "guardian",
  ward: "ward",

  // Social
  friend: "friend",
  friends: "friend",
  bestfriend: "friend",
  "best friend": "friend",
  buddy: "friend",
  pal: "friend",
  acquaintance: "friend",
  "friend / colleague": "friend",
  "friend / co-worker": "friend",
  "friend or colleague": "friend",
  "friend or co-worker": "friend",
  neighbor: "neighbor",
  neighbour: "neighbor",
  roommate: "roommate",
  flatmate: "roommate",
  // Work
  coworker: "co-worker",
  "co-worker": "co-worker",
  "co worker": "co-worker",
  colleague: "co-worker",
  "team member": "co-worker",
  teammate: "co-worker",
  collaborator: "co-worker",
  "work contact": "co-worker",
  manager: "manager",
  "line manager": "manager",
  "reporting manager": "manager",
  "reports to": "manager",
  "manager or coordinator": "manager",
  coordinator: "manager",
  boss: "manager",
  supervisor: "manager",
  report: "report",
  "direct report": "report",
  manages: "report",
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
  wife: "husband",
  husband: "wife",
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
  const key = normalizeLabelKey(label);
  if (!key) return "";
  const direct = LABEL_CANONICAL[key];
  if (direct) return direct;
  // "friend / colleague"-style compounds: fall back to the first segment.
  if (key.includes(" / ")) {
    const first = key.split(" / ")[0].trim();
    if (LABEL_CANONICAL[first]) return LABEL_CANONICAL[first];
  }
  // Modifier + known role ("spicy partner", "online boyfriend", "work friend")
  // folds onto the role. "ex-"/"former " keeps a distinct past-tense label so a
  // former bond never overwrites a current one.
  const words = key.split(" ");
  const isEx = /^(ex-|ex\s|former\s)/.test(key);
  const last = LABEL_CANONICAL[words[words.length - 1].replace(/^ex-/, "")];
  if (last && words.length > 1) return isEx ? `ex-${last}` : last;
  if (isEx && words.length === 1) {
    const bare = LABEL_CANONICAL[key.replace(/^ex-/, "")];
    if (bare) return `ex-${bare}`;
  }
  return key;
}


export function isSymmetricLabel(label: string): boolean {
  return SYMMETRIC_LABELS.has(canonicalLabel(label));
}

export function inverseLabel(label: string): string {
  const c = canonicalLabel(label);
  if (isSymmetricLabel(c)) return c;
  return INVERSE_LABEL[c] || c;
}

// spouse / husband / wife describe the SAME marriage edge. Collapse them for
// dedup so a gendered label never creates a second row next to a legacy
// "spouse" row.
const MARRIAGE_EQUIVALENT = new Set<string>(["spouse", "husband", "wife"]);

function pairKeyLabel(canonical: string): string {
  return MARRIAGE_EQUIVALENT.has(canonical) ? "spouse" : canonical;
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
  const c = pairKeyLabel(canonicalLabel(label));
  if (isSymmetricLabel(c)) {
    const [x, y] = [refKey(a), refKey(b)].sort();
    return `${userId}|sym|${c}|${x}|${y}`;
  }
  // Asymmetric: "a is L of b" ⇔ "b is inverseL of a". Build a direction-
  // independent key from the unordered set { (a, L), (b, inverseL) }.
  const inv = inverseLabel(c);
  const aSide = `${refKey(a)}:${c}`;
  const bSide = `${refKey(b)}:${inv}`;
  const [x, y] = [aSide, bSide].sort();
  return `${userId}|asym|${x}|${y}`;
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

/**
 * Ranking used to collapse several competing edges between the SAME two
 * people: the strongest claim wins, weaker ones are dropped. Higher = stronger.
 * Unranked labels sit above the weak social labels so we never drop a
 * meaningful family/work edge in favour of "friend".
 */
const RELATIONSHIP_STRENGTH: Record<string, number> = {
  spouse: 100,
  husband: 100,
  wife: 100,
  partner: 90,
  lover: 80,
  friend: 10,
};

export function relationshipStrength(label: string): number {
  return RELATIONSHIP_STRENGTH[canonicalLabel(label)] ?? 50;
}

/**
 * The set of labels that describe one romantic/social bond between two people.
 * Only these compete with each other for collapsing — a "friend" edge never
 * suppresses an unrelated "employer" edge.
 */
const ROMANTIC_SOCIAL_BOND = new Set<string>([
  "spouse", "husband", "wife", "partner", "lover", "friend",
]);

export function isRomanticSocialBond(label: string): boolean {
  return ROMANTIC_SOCIAL_BOND.has(canonicalLabel(label));
}

// ---------------------------------------------------------------------------
// Directional, gendered display
// ---------------------------------------------------------------------------

export type Gender = "male" | "female" | null;

/**
 * Derive a gender from a person's own profile facts. Never guesses from a
 * name — an unrecognised value yields null and the neutral role is shown.
 */
export function genderFromFacts(
  gender?: string | null,
  pronouns?: string | null,
): Gender {
  const g = String(gender || "").trim().toLowerCase();
  if (/^(m|male|man|boy|männlich|maennlich|mann)$/.test(g)) return "male";
  if (/^(f|female|woman|girl|weiblich|frau)$/.test(g)) return "female";
  const p = String(pronouns || "").trim().toLowerCase();
  if (/\bhe\b|\bhim\b|\bhis\b|\ber\/ihm\b/.test(p)) return "male";
  if (/\bshe\b|\bher\b|\bhers\b|\bsie\/ihr\b/.test(p)) return "female";
  return null;
}

/** Canonical role → [male form, female form]. */
const GENDERED_ROLE: Record<string, [string, string]> = {
  spouse: ["husband", "wife"],
  partner: ["boyfriend", "girlfriend"],
  parent: ["father", "mother"],
  child: ["son", "daughter"],
  sibling: ["brother", "sister"],
};

/** Roles that already carry a gender — no lookup needed. */
const INHERENTLY_GENDERED: Record<string, Gender> = {
  husband: "male", wife: "female",
  father: "male", mother: "female",
  son: "male", daughter: "female",
  brother: "male", sister: "female",
};

function titleCaseRole(role: string): string {
  return role.charAt(0).toUpperCase() + role.slice(1);
}

/**
 * Render a canonical role for display, applying the other person's gender
 * where the role has gendered forms. Falls back to the neutral role.
 */
export function displayRole(role: string, gender: Gender): string {
  const c = canonicalLabel(role);
  if (!c) return "";
  if (c in INHERENTLY_GENDERED) return titleCaseRole(c);
  const forms = GENDERED_ROLE[c];
  if (forms && gender) return titleCaseRole(gender === "male" ? forms[0] : forms[1]);
  return titleCaseRole(c);
}

export type DescribeRelationshipInput = {
  /** Stored edge: "source is <label> of target". */
  sourceType: string;
  sourceId: string | null;
  targetType: string;
  targetId: string | null;
  label: string;
  customLabel?: string | null;
  /** Whose profile is on screen. null = the owner ("self"). */
  viewingContactId: string | null;
  sourceName: string;
  targetName: string;
  /** Gender of the OTHER person, resolved from their own profile facts. */
  otherGender?: Gender;
};

export type RelationshipDescription = {
  /** The other person's name. */
  otherName: string;
  /** The role the OTHER person holds toward the viewed person, e.g. "Husband". */
  role: string;
  /** Ready-to-render "Role: Name". */
  display: string;
  /** Whether the viewed person is the stored edge's source. */
  viewingIsSource: boolean;
};

/**
 * Always answers the same question: *who is this other person to the person
 * whose profile I am looking at?* On Xihui's profile the answer is
 * "Husband: Michael"; on Michael's profile it is "Wife: Xihui".
 *
 * Storage convention is "source is <label> of target", so when the viewer IS
 * the source the other person's role is the INVERSE of the stored label; when
 * the viewer is the target the stored label already names the other's role.
 */
export function describeRelationship(input: DescribeRelationshipInput): RelationshipDescription {
  const {
    sourceType, sourceId, targetType, targetId,
    label, customLabel, viewingContactId,
    sourceName, targetName, otherGender = null,
  } = input;

  const viewingIsSource =
    (viewingContactId === null && sourceType === "self") ||
    (viewingContactId !== null && sourceType === "contact" && sourceId === viewingContactId);

  const otherName = viewingIsSource ? targetName : sourceName;
  void targetId;

  // A user-authored custom label is verbatim and never inverted or gendered.
  if (customLabel && customLabel.trim()) {
    const role = customLabel.trim();
    return {
      otherName,
      role: titleCaseRole(role),
      display: `${titleCaseRole(role)}: ${otherName}`,
      viewingIsSource,
    };
  }

  const stored = canonicalLabel(label);
  const otherRole = viewingIsSource ? inverseLabel(stored) : stored;
  const role = displayRole(otherRole, otherGender);

  return {
    otherName,
    role,
    display: role ? `${role}: ${otherName}` : otherName,
    viewingIsSource,
  };
}
// --- END SHARED CORE ---
