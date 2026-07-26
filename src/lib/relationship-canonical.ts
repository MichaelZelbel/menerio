// Mirror of supabase/functions/_shared/relationship-canonical.ts for frontend.
// Keep in sync.

export type EntityRef = {
  type: "contact" | "self";
  id: string | null;
};

const LABEL_CANONICAL: Record<string, string> = {
  wife: "wife",
  husband: "husband",
  spouse: "spouse",
  married: "spouse",
  marriage: "spouse",
  "life partner": "spouse",
  ehefrau: "wife",
  ehemann: "husband",
  ehepartner: "spouse",
  partner: "partner",
  girlfriend: "partner",
  boyfriend: "partner",
  fiance: "partner",
  fiancee: "partner",
  lover: "lover",
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
  manager: "manager",
  "line manager": "manager",
  "reporting manager": "manager",
  "reports to": "manager",
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

const SYMMETRIC_LABELS = new Set<string>([
  "spouse", "partner", "lover", "friend", "sibling", "co-worker", "neighbor", "roommate",
]);

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
  const inv = inverseLabel(c);
  const aSide = `${refKey(a)}:${c}`;
  const bSide = `${refKey(b)}:${inv}`;
  const [x, y] = [aSide, bSide].sort();
  return `${userId}|asym|${x}|${y}`;
}
