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
      { canonical: "Nickname", single: false, aliases: ["nickname", "nicknames", "alias", "aliases", "name aliases", "handle", "pet name", "aka", "also known as", "known as"] },
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

/**
 * Additional label aliasing for OPEN categories. The schema above intentionally
 * keeps open categories free-form, but a handful of near-synonymous labels
 * (Favorite foods / Favorite food/drink / Favorite cuisine …) cause massive
 * duplicate rows in practice. Mapping them to one canonical label makes the
 * deterministic exact-duplicate collapser in `profile-normalization.ts` fold
 * them together without pulling the category out of "open" shape.
 */
export const OPEN_CATEGORY_LABEL_ALIASES: Record<string, string> = {
  // Food — collapse singular/plural/synonym variants into plural canonical.
  "favorite food": "Favorite foods",
  "favorite foods": "Favorite foods",
  "favorite food/drink": "Favorite foods",
  "favorite dish": "Favorite foods",
  "favorite dishes": "Favorite foods",
  "favorite cuisine": "Favorite foods",
  "favorite cuisines": "Favorite foods",
  "favorite drink": "Favorite drinks",
  "favorite drinks": "Favorite drinks",
  "favorite beverage": "Favorite drinks",
  "favorite beverages": "Favorite drinks",
  "favorite dessert": "Favorite desserts",
  "favorite desserts": "Favorite desserts",
  "favorite snack": "Favorite snacks",
  "favorite snacks": "Favorite snacks",
  "favorite fruit": "Favorite fruits",
  "favorite fruits": "Favorite fruits",
  "favorite restaurant": "Favorite restaurants",
  "favorite restaurants": "Favorite restaurants",
  // Entertainment — same pattern.
  "favorite song": "Favorite songs",
  "favorite songs": "Favorite songs",
  "favorite movie": "Favorite movies",
  "favorite movies": "Favorite movies",
  "favorite film": "Favorite movies",
  "favorite films": "Favorite movies",
  "favorite show": "Favorite TV shows",
  "favorite shows": "Favorite TV shows",
  "favorite tv show": "Favorite TV shows",
  "favorite tv shows": "Favorite TV shows",
  "favorite music artist": "Favorite music artists",
  "favorite music artists": "Favorite music artists",
  "favorite artist": "Favorite music artists",
  "favorite artists": "Favorite music artists",
  "favorite band": "Favorite music artists",
  "favorite bands": "Favorite music artists",
  "favorite character": "Favorite characters",
  "favorite characters": "Favorite characters",
  "favorite youtuber": "Favorite YouTubers",
  "favorite youtubers": "Favorite YouTubers",
  "favorite place": "Favorite places",
  "favorite places": "Favorite places",
  // Personality / relational
  "love language": "Love language",
  "love languages": "Love language",
  "love language(s)": "Love language",
  // Identity-ish extras (routed via GLOBAL map, not tied to a structured cat)
  "ethnicity": "Ethnicity",
  "ethnic background": "Ethnicity",
  // Health — collapse the many synonyms real notes produce into one
  // list-valued canonical so the deterministic list merger folds them.
  "allergy": "Allergies",
  "allergies": "Allergies",
  "allergen": "Allergies",
  "allergens": "Allergies",
  "food allergy": "Allergies",
  "food allergies": "Allergies",
  "health condition": "Health conditions",
  "health conditions": "Health conditions",
  "medical condition": "Health conditions",
  "medical conditions": "Health conditions",
  "physical health condition": "Health conditions",
  "physical health conditions": "Health conditions",
  "mental health condition": "Health conditions",
  "mental health conditions": "Health conditions",
  "chronic condition": "Health conditions",
  "chronic conditions": "Health conditions",
  "diagnosis": "Health conditions",
  "diagnoses": "Health conditions",
  "condition": "Health conditions",
  "health issue": "Health conditions",
  "health issues": "Health conditions",
  "allergic to": "Allergies",
  "medication": "Medications",
  "medications": "Medications",
  "current medication": "Medications",
  "current medications": "Medications",
  "history of hospitalization": "Hospitalization history",
  "hospitalization history": "Hospitalization history",
  "hospitalisation history": "Hospitalization history",
  "vrchat activities": "VRChat activities",
  "vrchat activity": "VRChat activities",
  "favorite games": "Favorite games",
  "favorite game": "Favorite games",
  "hobbies": "Hobbies",
  "hobby": "Hobbies",
  "pet": "Pets",
  "pets": "Pets",
  "routine": "Routine",
  "daily routine": "Daily routine",
  "work arrangement": "Work arrangement",
};


/**
 * Canonical labels whose semantic is "a set of tokens" (nicknames, favorite
 * foods, …). The normalizer merges same-label rows for one subject into a
 * single row whose value is the deduplicated union of comma-split tokens.
 */
export const LIST_VALUED_LABELS: Set<string> = new Set(
  [
    "Nickname",
    "Aliases",
    "Favorite food",
    "Favorite drink",
    "Favorite dessert",
    "Love language",
    "Skill",
    "Hobby",
    "Interest",
    "Allergies",
    "Health conditions",
    "Medications",
    "Pets",
    "Personality traits",
    "VRChat setup",
    "VRChat equipment",
    "VRChat activities",
    "Favorite games",
    "Hobbies",
    "Likes",
  ].map((s) => s.toLowerCase()),
);

export function isListValuedLabel(canonicalLabel: string): boolean {
  return LIST_VALUED_LABELS.has(String(canonicalLabel || "").trim().toLowerCase());
}

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

for (const [alias, canonical] of Object.entries(OPEN_CATEGORY_LABEL_ALIASES)) {
  GLOBAL_ALIAS_MAP.set(alias.toLowerCase(), canonical);
  GLOBAL_ALIAS_MAP.set(canonical.toLowerCase(), canonical);
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
  const HEALTH_LABELS = new Set([
    "allergies",
    "health conditions",
    "medications",
  ]);

  if (IDENTITY_LABELS.has(canonLower)) return "identity";
  if (RELATIONSHIP_LABELS.has(canonLower)) return "relationships";
  if (HEALTH_LABELS.has(canonLower)) return "health";
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

// Deterministic label→category home for the contact quick-add pre-pass. Maps
// every structured-category alias/canonical (normalized) to its owning slug +
// canonical label. A key claimed by two *different* structured categories is
// flagged ambiguous and never resolved deterministically (deferred to the LLM).
type StructuredLabelHome = { slug: string; canonical: string; ambiguous: boolean };
const STRUCTURED_LABEL_HOME: Map<string, StructuredLabelHome> = (() => {
  const m = new Map<string, StructuredLabelHome>();
  for (const [slug, schema] of Object.entries(PROFILE_CANONICAL_SCHEMA)) {
    if (schema.shape !== "structured") continue;
    for (const def of schema.labels) {
      for (const key of [def.canonical, ...def.aliases]) {
        const nk = normalizeKey(key);
        if (!nk) continue;
        const existing = m.get(nk);
        if (!existing) {
          m.set(nk, { slug, canonical: def.canonical, ambiguous: false });
        } else if (existing.slug !== slug) {
          existing.ambiguous = true;
        }
      }
    }
  }
  return m;
})();

/**
 * Deterministic label→category match for the contact quick-add pre-pass. When
 * `label` is a known, unambiguous alias/canonical of exactly one STRUCTURED
 * category, returns that category slug plus its canonical label; otherwise
 * returns null so the caller falls back to the LLM. Open categories (which have
 * no fixed labels) never match here — freeform topics always defer to the LLM.
 * Pure — no I/O.
 */
export function matchProfileCategoryByLabel(
  label: string,
): { slug: string; canonicalLabel: string } | null {
  const key = normalizeKey(label);
  if (!key) return null;
  const hit = STRUCTURED_LABEL_HOME.get(key);
  if (!hit || hit.ambiguous) return null;
  return { slug: hit.slug, canonicalLabel: hit.canonical };
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
