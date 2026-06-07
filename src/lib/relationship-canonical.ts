// Mirror of supabase/functions/_shared/relationship-canonical.ts for frontend.
// Keep in sync.

export type EntityRef = {
  type: "contact" | "self";
  id: string | null;
};

const LABEL_CANONICAL: Record<string, string> = {
  wife: "spouse",
  husband: "spouse",
  spouse: "spouse",
  married: "spouse",
  marriage: "spouse",
  "life partner": "spouse",
  ehefrau: "spouse",
  ehemann: "spouse",
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

function refKey(ref: EntityRef): string {
  return `${ref.type}:${ref.id || "self"}`;
}

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
