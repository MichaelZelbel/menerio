/**
 * Presentation-layer helpers for profile entries. These decide how a stored
 * (label, value) pair is *rendered* — they never rewrite what's saved in the
 * database. The edge-function normalizer still owns canonicalization at
 * write time; this file just makes existing rows and novel LLM-invented
 * labels display consistently.
 */

const norm = (s: string) => String(s ?? "").trim().toLowerCase();

/**
 * Labels whose value is a single natural-language fact that may legitimately
 * contain commas ("pizza, extra cheese, no olives"). Never render as a list
 * even when the value has multiple comma-separated fragments.
 */
const SINGLE_FACT_LABELS: ReadonlySet<string> = new Set(
  [
    "Favorite McDonald's order",
    "Favorite mcdonalds order",
    "Go-to recipe",
    "Signature dish",
    "Current address",
    "Previous address",
    "Home address",
    "Work address",
    "Wedding location",
    "Place of birth",
    "Full name",
    "Legal name",
    "Preferred name",
    "Date of birth",
    "Birthday",
    "Dietary style",
    "Cooking skill level",
    "Timezone",
    "Job title",
    "Employer",
    "Company",
    "Height",
    "Weight",
    "Eye color",
    "Hair color",
    "Blood type",
    "Phone",
    "Email",
    "Website",
  ].map(norm),
);

/**
 * Labels that should always render as a bulleted list, even when the value
 * currently holds a single item — keeps the visual language consistent for
 * collection-style fields.
 */
const ALWAYS_LIST_LABELS: ReadonlySet<string> = new Set(
  [
    "Nickname",
    "Nicknames",
    "Aliases",
    "Skills",
    "Skill",
    "Hobbies",
    "Hobby",
    "Interests",
    "Interest",
    "Allergies",
    "Health conditions",
    "Medications",
    "Pets",
    "Personality traits",
    "Likes",
    "Dislikes",
  ].map(norm),
);

/**
 * Split a comma-separated profile value into individual items. Trims each
 * item and drops empties. Preserves original casing/wording.
 */
export function splitListValue(value: string): string[] {
  return String(value ?? "")
    .split(",")
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
}

/**
 * Decide whether a stored (label, value) pair should render as a bulleted
 * list. Shape-based: any label that isn't a known single-fact label and
 * whose value contains 2+ comma-separated items is a list. Handful of
 * always-list labels render as bullets even with a single item.
 */
export function shouldRenderAsList(label: string, value: string): boolean {
  const key = norm(label);
  if (SINGLE_FACT_LABELS.has(key)) return false;
  if (ALWAYS_LIST_LABELS.has(key)) return true;
  return splitListValue(value).length >= 2;
}

/**
 * Legacy alias — some callers still import `isListValuedLabel`. Prefer
 * `shouldRenderAsList` since it accounts for the actual value shape.
 */
export function isListValuedLabel(label: string): boolean {
  return ALWAYS_LIST_LABELS.has(norm(label));
}

/**
 * Existing rows in the DB still carry singular labels the LLM invented
 * before the plural canonicals landed. Present them in plural at render
 * time; storage stays untouched.
 */
const DISPLAY_LABEL_MAP: ReadonlyMap<string, string> = new Map(
  Object.entries({
    "favorite restaurant": "Favorite restaurants",
    "favorite snack": "Favorite snacks",
    "favorite tv show": "Favorite TV shows",
    "favorite movie": "Favorite movies",
    "favorite song": "Favorite songs",
    "favorite music artist": "Favorite music artists",
    "favorite artist": "Favorite artists",
    "favorite character": "Favorite characters",
    "favorite youtuber": "Favorite YouTubers",
    "favorite fruit": "Favorite fruits",
    "favorite dessert": "Favorite desserts",
    "favorite drink": "Favorite drinks",
    "favorite food": "Favorite foods",
    "favorite place": "Favorite places",
    "favorite game": "Favorite games",
    "favorite color": "Favorite colors",
    "favorite animal": "Favorite animals",
    "favorite book": "Favorite books",
    "favorite author": "Favorite authors",
    "favorite podcast": "Favorite podcasts",
    "favorite band": "Favorite bands",
    "favorite album": "Favorite albums",
    "favorite hobby": "Favorite hobbies",
    "favorite show": "Favorite shows",
    "favorite series": "Favorite series",
    "favorite sport": "Favorite sports",
  }),
);

/**
 * Map a stored label to the label used in the UI. Falls back to the raw
 * stored label so unknown singulars aren't mangled by a generic pluralizer.
 */
export function displayLabel(label: string): string {
  const raw = String(label ?? "");
  return DISPLAY_LABEL_MAP.get(norm(raw)) ?? raw;
}

/**
 * Title-case a fictional-character name. Only used for `Favorite characters`,
 * where the LLM pipeline stores everything lowercase. Tokens that already
 * contain an uppercase letter are left untouched (e.g. stylized names).
 */
export function titleCaseCharacterName(name: string): string {
  const trimmed = String(name ?? "").trim();
  if (!trimmed) return trimmed;
  if (/[A-Z]/.test(trimmed)) return trimmed;
  return trimmed.replace(/\b([a-z])/g, (_, c: string) => c.toUpperCase());
}

export function isCharacterLabel(label: string): boolean {
  const key = norm(label);
  return key === "favorite characters" || key === "favorite character";
}
