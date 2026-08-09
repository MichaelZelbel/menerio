// Deterministic guard for "Skill"-style list facts.
//
// The extractor used to dump every proper noun it saw near a professional
// paragraph into `Skill`, which produced nonsense like
//   Skill: German, English, Phil Benton, Menerio, hub routines, OpenClaw, blockchain
// A person's name, a product name, a language and a bare topic are all NOT
// skills. This module routes each list member to where it belongs, or drops
// it, without calling an LLM.

export type SkillRoute =
  | { action: "keep"; member: string }
  | { action: "rehome"; member: string; label: string; categorySlug: string; reason: string }
  | { action: "drop"; member: string; reason: string };

export type SkillGuardContext = {
  /** Known person names: contacts, their aliases, and the owner's own names. */
  personNames?: Iterable<string>;
  /** Known product / company / project names (owner's own products included). */
  productNames?: Iterable<string>;
};

const LANGUAGE_NAMES = new Set(
  [
    "german", "deutsch", "english", "englisch", "french", "französisch", "francais", "spanish",
    "spanisch", "italian", "italienisch", "portuguese", "dutch", "niederländisch", "russian",
    "polish", "czech", "swedish", "norwegian", "danish", "finnish", "greek", "turkish", "arabic",
    "hebrew", "hindi", "urdu", "bengali", "chinese", "mandarin", "cantonese", "japanese",
    "japanisch", "korean", "vietnamese", "thai", "indonesian", "malay", "tagalog", "ukrainian",
    "romanian", "hungarian", "bulgarian", "croatian", "serbian", "slovak", "slovenian", "latin",
    "mandarin chinese", "simplified chinese", "traditional chinese", "sign language",
  ],
);

// Bare subject-matter nouns. A topic is something you are interested in — it
// only becomes a skill when paired with a doing-word ("blockchain
// development", "AI engineering").
const TOPIC_TERMS = new Set(
  [
    "ai", "artificial intelligence", "enterprise ai", "sap ai", "genai", "generative ai",
    "machine learning", "ml", "deep learning", "llm", "llms", "nlp", "blockchain", "crypto",
    "cryptocurrency", "web3", "nft", "nfts", "metaverse", "virtual reality", "vr",
    "augmented reality", "ar", "xr", "iot", "quantum computing", "robotics", "big data",
    "cloud", "cybersecurity", "sustainability", "agentic workflows", "agentic ai", "agents",
    "automation", "tooling", "orchestration", "digital transformation", "innovation",
  ],
);

// Words that turn a topic into an actual capability.
const SKILL_HEAD_WORDS = [
  "development", "developing", "engineering", "programming", "coding", "design", "designing",
  "architecture", "management", "managing", "consulting", "coaching", "teaching", "training",
  "analysis", "analytics", "research", "writing", "editing", "translation", "negotiation",
  "leadership", "facilitation", "modeling", "modelling", "testing", "administration",
  "strategy", "marketing", "sales", "support", "operations", "prototyping", "integration",
  "migration", "security", "review", "planning", "budgeting", "public speaking", "presentation",
];

function norm(s: string): string {
  return String(s || "")
    .toLowerCase()
    .replace(/[.,;:!?]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function toSet(it?: Iterable<string>): Set<string> {
  const out = new Set<string>();
  for (const v of it || []) {
    const n = norm(v);
    if (n) out.add(n);
  }
  return out;
}

/** "OpenClaw", "SAP", "iPhone" — brand-shaped tokens (inner capital / all-caps). */
function looksLikeBrandToken(member: string): boolean {
  const t = member.trim();
  if (!t || /\s/.test(t)) {
    // multiword: brand-shaped only if a word has an inner capital
    return t.split(/\s+/).some((w) => /^[A-Za-z][a-z]+[A-Z]/.test(w));
  }
  if (/^[A-Za-z][a-z]+[A-Z]/.test(t)) return true; // OpenClaw, YouTube
  if (/^[A-Z]{2,}$/.test(t) && t.length <= 6 && !/^(AI|VR|AR|ML|UX|UI|QA|SQL|CSS|API)$/i.test(t)) return true;
  return false;
}

function hasSkillHead(lower: string): boolean {
  return SKILL_HEAD_WORDS.some((w) => lower === w || lower.includes(w));
}

/**
 * Route a single member of a Skill list.
 * Pure + deterministic: same inputs always give the same answer.
 */
export function routeSkillMember(member: string, ctx: SkillGuardContext = {}): SkillRoute {
  const raw = String(member || "").trim();
  const lower = norm(raw);
  if (!lower) return { action: "drop", member: raw, reason: "empty" };

  const persons = toSet(ctx.personNames);
  const products = toSet(ctx.productNames);

  // 1. A person is never a skill.
  if (persons.has(lower)) {
    return { action: "drop", member: raw, reason: "person name, not a skill" };
  }
  if (/^(mr|mrs|ms|dr|prof)\.?\s+\p{Lu}/u.test(raw)) {
    return { action: "drop", member: raw, reason: "person name, not a skill" };
  }

  // 2. Languages belong to Identity → Language.
  if (LANGUAGE_NAMES.has(lower.replace(/\s*\(.*\)$/, ""))) {
    return { action: "rehome", member: raw, label: "Language", categorySlug: "identity", reason: "language, not a skill" };
  }

  // 3. Products / companies / internal jargon → Tool / platform.
  if (products.has(lower)) {
    return { action: "rehome", member: raw, label: "Tool / platform", categorySlug: "professional", reason: "product or company name, not a skill" };
  }
  if (!hasSkillHead(lower) && looksLikeBrandToken(raw)) {
    return { action: "rehome", member: raw, label: "Tool / platform", categorySlug: "professional", reason: "brand or product name, not a skill" };
  }

  // 4. Bare topics → Topic of interest.
  if (TOPIC_TERMS.has(lower) && !hasSkillHead(lower)) {
    return { action: "rehome", member: raw, label: "Topic of interest", categorySlug: "professional", reason: "subject area, not a skill" };
  }

  return { action: "keep", member: raw };
}

export function routeSkillMembers(members: string[], ctx: SkillGuardContext = {}): SkillRoute[] {
  return members.map((m) => routeSkillMember(m, ctx));
}

/** Convenience: split a comma-joined Skill value and route every member. */
export function routeSkillValue(value: string, ctx: SkillGuardContext = {}): SkillRoute[] {
  const members = String(value || "")
    .split(/\s*[,;·•]\s*|\s+\/\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
  return routeSkillMembers(members, ctx);
}

export function isSkillLabel(label: string): boolean {
  const l = norm(label);
  return l === "skill" || l === "skills" || l === "expertise" || l === "competency" || l === "specialty";
}
