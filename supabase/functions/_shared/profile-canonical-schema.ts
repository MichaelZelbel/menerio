// Single source of truth for canonical profile labels across owner + contact
// profiles. Phase A: source-side only — used to shape NEWLY-extracted facts
// before they're written. NOT used to merge/relabel existing rows.

export type CanonicalLabelDef = {
  canonical: string;
  single: boolean;
  aliases: string[];
};

export type CategoryShape = "structured" | "open";

export type CategorySchema = {
  shape: CategoryShape;
  labels: CanonicalLabelDef[];
};

// Categories whose labels we DO normalize.
export const PROFILE_CANONICAL_SCHEMA: Record<string, CategorySchema> = {
  identity: {
    shape: "structured",
    labels: [
      { canonical: "Full name", single: true, aliases: ["legal name", "name", "full legal name"] },
      { canonical: "Preferred name", single: true, aliases: ["first name", "goes by", "preferred name"] },
      { canonical: "Nickname", single: false, aliases: ["nickname", "alias", "handle", "pet name", "aka", "also known as", "known as"] },
      { canonical: "Date of birth", single: true, aliases: ["birthday", "dob", "born on", "geburtsdatum", "geburtstag", "date of birth", "birth date"] },
      { canonical: "Place of birth", single: true, aliases: ["birthplace", "born in", "place of birth"] },
      { canonical: "Nationality", single: false, aliases: ["citizenship", "nationality"] },
      { canonical: "Gender", single: true, aliases: ["gender"] },
      { canonical: "Pronouns", single: true, aliases: ["pronouns"] },
      { canonical: "Marital status", single: true, aliases: ["marital status"] },
      { canonical: "Maiden name", single: true, aliases: ["nee", "née", "birth surname", "maiden name"] },
      { canonical: "Married surname", single: true, aliases: ["married name", "married surname"] },
      { canonical: "Religion", single: true, aliases: ["faith", "religion"] },
      { canonical: "Height", single: true, aliases: ["height", "körpergröße", "koerpergroesse", "größe"] },
      { canonical: "Eye color", single: true, aliases: ["eye color", "eye colour", "augenfarbe"] },
      { canonical: "Hair color", single: true, aliases: ["hair color", "hair colour", "haarfarbe"] },
      { canonical: "Blood type", single: true, aliases: ["blood type", "blood group", "blutgruppe"] },
      { canonical: "Pronunciation", single: true, aliases: ["pronunciation", "name pronunciation", "pronounced"] },
    ],
  },
  location: {
    shape: "structured",
    labels: [
      { canonical: "Current address", single: true, aliases: ["address", "home address", "residence", "current address"] },
      { canonical: "Current city", single: true, aliases: ["city", "lives in", "based in", "located in", "current city"] },
      { canonical: "Current country", single: true, aliases: ["country", "current country"] },
      { canonical: "Previous address", single: false, aliases: ["former address", "old address", "past address", "previous address"] },
      { canonical: "Previous city", single: false, aliases: ["former city", "used to live in", "previous city"] },
      { canonical: "Timezone", single: true, aliases: ["timezone", "time zone"] },
    ],
  },
  professional: {
    shape: "structured",
    labels: [
      { canonical: "Job title", single: true, aliases: ["role", "title", "position", "current role", "job title", "current job title"] },
      { canonical: "Employer", single: true, aliases: ["company", "current company", "works at", "organization", "employer"] },
      { canonical: "Industry", single: true, aliases: ["sector", "field", "industry"] },
      { canonical: "Previous employer", single: false, aliases: ["former company", "ex-employer", "previous employer", "former employer"] },
      { canonical: "Skill", single: false, aliases: ["skill", "skills", "expertise", "specialty", "competency"] },
      { canonical: "Years of experience", single: true, aliases: ["years of experience"] },
      { canonical: "Professional summary", single: true, aliases: ["bio", "headline", "about", "professional summary"] },
    ],
  },
  education: {
    shape: "structured",
    labels: [
      { canonical: "Degree", single: false, aliases: ["qualification", "diploma", "degree"] },
      { canonical: "Field of study", single: false, aliases: ["major", "subject", "field of study"] },
      { canonical: "School", single: false, aliases: ["university", "college", "institution", "alma mater", "school"] },
      { canonical: "Graduation year", single: false, aliases: ["graduation year"] },
      { canonical: "Certification", single: false, aliases: ["certificate", "credential", "license", "certification"] },
    ],
  },
  relationships: {
    shape: "structured",
    labels: [
      { canonical: "Spouse", single: true, aliases: ["wife", "husband", "married to", "spouse"] },
      { canonical: "Partner", single: true, aliases: ["girlfriend", "boyfriend", "fiance", "fiancee", "fiancée", "life partner", "partner"] },
      { canonical: "Child", single: false, aliases: ["son", "daughter", "kids", "child", "children"] },
      { canonical: "Parent", single: false, aliases: ["mother", "father", "mom", "dad", "parent"] },
      { canonical: "Sibling", single: false, aliases: ["brother", "sister", "sibling"] },
      { canonical: "Relationship status", single: true, aliases: ["relationship status"] },
      { canonical: "How we met", single: false, aliases: ["how we met"] },
      { canonical: "Wedding date", single: true, aliases: ["marriage date", "wedding anniversary", "anniversary (marriage)", "hochzeitstag", "wedding date"] },
      { canonical: "Wedding location", single: true, aliases: ["marriage location", "married in", "wedding location"] },
    ],
  },
  communication: {
    shape: "structured",
    labels: [
      { canonical: "Email", single: false, aliases: ["email", "email address", "e-mail"] },
      { canonical: "Phone", single: false, aliases: ["phone", "mobile", "cell", "telephone", "number"] },
      { canonical: "Preferred channel", single: true, aliases: ["best way to reach", "preferred channel"] },
      { canonical: "Social handle", single: false, aliases: ["social handle", "linkedin", "x", "twitter", "instagram", "discord", "telegram", "whatsapp"] },
      { canonical: "Website", single: false, aliases: ["website", "url", "homepage", "blog", "linktree"] },
    ],
  },
  financial: {
    shape: "structured",
    labels: [
      { canonical: "Income", single: true, aliases: ["salary", "earnings", "income"] },
      { canonical: "Currency", single: true, aliases: ["currency"] },
      { canonical: "Payment method", single: false, aliases: ["ko-fi", "paypal", "bank", "payment method"] },
      { canonical: "Account / asset", single: false, aliases: ["account", "asset", "account / asset"] },
    ],
  },
  // Open categories: keep labels as-is.
  personality: { shape: "open", labels: [] },
  principles: { shape: "open", labels: [] },
  health: { shape: "open", labels: [] },
  hobbies: { shape: "open", labels: [] },
  food: { shape: "open", labels: [] },
  entertainment: { shape: "open", labels: [] },
  travel: { shape: "open", labels: [] },
  digital: { shape: "open", labels: [] },
  goals: { shape: "open", labels: [] },
  preferences: { shape: "open", labels: [] },
};

// Build per-category alias→canonical lookup.
const PER_CATEGORY_ALIAS_MAP: Record<string, Map<string, string>> = {};
// Global alias map for re-homing across categories.
const GLOBAL_ALIAS_MAP: Map<string, string> = new Map();
// Set of canonical labels that are single-valued.
const SINGLE_VALUE_CANONICAL: Set<string> = new Set();

for (const [slug, schema] of Object.entries(PROFILE_CANONICAL_SCHEMA)) {
  const m = new Map<string, string>();
  for (const def of schema.labels) {
    if (def.single) SINGLE_VALUE_CANONICAL.add(def.canonical.toLowerCase());
    m.set(def.canonical.toLowerCase(), def.canonical);
    GLOBAL_ALIAS_MAP.set(def.canonical.toLowerCase(), def.canonical);
    for (const a of def.aliases) {
      m.set(a.toLowerCase(), def.canonical);
      GLOBAL_ALIAS_MAP.set(a.toLowerCase(), def.canonical);
    }
  }
  PER_CATEGORY_ALIAS_MAP[slug] = m;
}

function normalizeKey(label: string): string {
  return String(label || "")
    .trim()
    .replace(/^[\p{P}\s]+|[\p{P}\s]+$/gu, "")
    .toLowerCase();
}

export function canonicalProfileLabel(categorySlug: string, label: string): string {
  const schema = PROFILE_CANONICAL_SCHEMA[categorySlug];
  const key = normalizeKey(label);
  if (!key) return label;
  // Open categories: do not force canonicalization, but still apply global
  // re-mapping for labels that have a clear canonical home.
  if (!schema || schema.shape === "open") {
    return GLOBAL_ALIAS_MAP.get(key) || label;
  }
  const m = PER_CATEGORY_ALIAS_MAP[categorySlug];
  const hit = m?.get(key);
  if (hit) return hit;
  // Fall back to global map (so a re-homed label still gets canonicalized).
  return GLOBAL_ALIAS_MAP.get(key) || label;
}

export function correctProfileCategory(label: string, currentSlug: string): string {
  const key = normalizeKey(label);
  if (!key) return currentSlug;
  // Resolve to canonical first (via any category that knows this alias).
  const canonical = GLOBAL_ALIAS_MAP.get(key) || label;
  const canonLower = canonical.toLowerCase();

  const IDENTITY_LABELS = new Set(["place of birth"]);
  const RELATIONSHIP_LABELS = new Set([
    "wedding date",
    "wedding location",
    "spouse",
    "partner",
    "child",
    "parent",
    "sibling",
  ]);

  if (IDENTITY_LABELS.has(canonLower)) return "identity";
  if (RELATIONSHIP_LABELS.has(canonLower)) return "relationships";
  return currentSlug;
}

export function isSingleValueLabel(canonicalLabel: string): boolean {
  return SINGLE_VALUE_CANONICAL.has(String(canonicalLabel || "").trim().toLowerCase());
}

/**
 * Strip ONE trailing parenthetical qualifier from a value:
 * `5'4" (fun sized)` → `5'4"`. Values that are entirely parenthetical
 * (e.g. `(unknown)`) are returned unchanged so we never strip to empty.
 */
export function stripTrailingQualifier(value: string): string {
  const raw = String(value || "").trim();
  const stripped = raw.replace(/\s*\([^()]*\)$/u, "").trim();
  return stripped.length > 0 ? stripped : raw;
}

/**
 * Normalize a profile value for DEDUP COMPARISON only (never for storage):
 * trailing parenthetical qualifiers removed, whitespace collapsed, lowercased.
 * Makes `5'4"` and `5'4" (fun sized)` compare equal so extraction pipelines
 * don't insert semantically duplicate entries.
 */
export function normalizeProfileValueForDedup(value: string): string {
  return stripTrailingQualifier(value).toLowerCase().replace(/\s+/g, " ");
}

// Compact human-readable list grouped by category — for LLM system prompts.
export const CANONICAL_LABELS_FOR_PROMPT: string = (() => {
  const lines: string[] = [];
  for (const [slug, schema] of Object.entries(PROFILE_CANONICAL_SCHEMA)) {
    if (schema.shape === "open" || schema.labels.length === 0) continue;
    const names = schema.labels.map((l) => l.canonical).join(", ");
    lines.push(`- ${slug}: ${names}`);
  }
  return lines.join("\n");
})();
