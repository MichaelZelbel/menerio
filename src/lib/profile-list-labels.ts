/**
 * Client-side mirror of `LIST_VALUED_LABELS` from
 * `supabase/functions/_shared/profile-canonical-schema.ts`. Duplicated (not
 * imported) because the browser bundle can't reach into edge-function code.
 * Keep in sync with the server list.
 */
const LIST_VALUED_LABELS: ReadonlySet<string> = new Set(
  [
    "Nickname",
    "Aliases",
    "Favorite foods",
    "Favorite drinks",
    "Favorite desserts",
    "Favorite snacks",
    "Favorite fruits",
    "Favorite restaurants",
    "Favorite songs",
    "Favorite movies",
    "Favorite TV shows",
    "Favorite music artists",
    "Favorite characters",
    "Favorite YouTubers",
    "Favorite places",
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

export function isListValuedLabel(label: string): boolean {
  return LIST_VALUED_LABELS.has(String(label || "").trim().toLowerCase());
}

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

const CHARACTER_LABEL = "favorite characters";

export function isCharacterLabel(label: string): boolean {
  return String(label || "").trim().toLowerCase() === CHARACTER_LABEL;
}
