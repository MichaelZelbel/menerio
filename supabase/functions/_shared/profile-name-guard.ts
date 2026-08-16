/**
 * Deterministic guard for name-ish profile labels (Nickname, Name, Legal
 * name, Preferred name, …).
 *
 * The extractor kept filing online handles and OCR noise as "nicknames"
 * ("yaunderε", "ChocolaJoy"), and re-filing the person's own name as a
 * nickname. Those are not judgment calls, so they are decided in code, before
 * the LLM's output is allowed to hit `profile_entries`.
 *
 * Decisions:
 *  - keep   → store as-is (possibly cleaned)
 *  - relabel→ store under a different label (handles go to "Online handle")
 *  - drop   → do not store at all
 */

export type NameGuardDecision =
  | { action: "keep"; label: string; value: string }
  | { action: "relabel"; label: string; value: string; reason: string }
  | { action: "drop"; reason: string };

const NAME_LABELS = new Set([
  "nickname",
  "nicknames",
  "name",
  "full name",
  "legal name",
  "preferred name",
  "first name",
  "last name",
  "middle name",
  "maiden name",
]);

export function isNameLabel(label: string): boolean {
  return NAME_LABELS.has(String(label || "").trim().toLowerCase());
}

function norm(s: string): string {
  return String(s || "").trim().toLowerCase().replace(/\s+/g, " ");
}

/** Latin + CJK + Cyrillic + Hangul + spacing/punctuation used in real names. */
const NAME_SAFE_RE =
  /^[\p{Script=Latin}\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\p{Script=Cyrillic}\p{M}\p{Zs}'’\-.·]+$/u;

/** Looks like an account handle rather than a name. */
function isHandleShaped(value: string): boolean {
  const v = value.trim();
  if (/^@/.test(v)) return true;
  if (/[_/\\]|https?:\/\//i.test(v)) return true;
  if (/\d/.test(v) && !/^\p{Lu}/u.test(v)) return true;
  // CamelCase mash with no space: "ChocolaJoy", "DarkSoulz99"
  if (!/\s/.test(v) && v.length >= 7 && /\p{Ll}\p{Lu}/u.test(v)) return true;
  return false;
}

export interface NameGuardInput {
  label: string;
  value: string;
  /** The person's canonical/display name, when known. */
  personName?: string | null;
  /** Other names already stored for this person (aliases, nicknames). */
  knownNames?: string[];
}

export function guardNameValue({
  label,
  value,
  personName,
  knownNames = [],
}: NameGuardInput): NameGuardDecision {
  const cleaned = String(value || "").trim().replace(/\s+/g, " ");
  const canonicalLabel = isNameLabel(label) ? label.trim() : label;

  if (!isNameLabel(label)) return { action: "keep", label: canonicalLabel, value: cleaned };

  if (!cleaned) return { action: "drop", reason: "empty" };
  if (cleaned.length > 60) return { action: "drop", reason: "too_long_for_a_name" };

  // Case/spacing duplicate of the person's own name is not a nickname.
  if (personName && norm(personName) === norm(cleaned)) {
    return { action: "drop", reason: "same_as_person_name" };
  }
  if (knownNames.some((n) => norm(n) === norm(cleaned))) {
    return { action: "drop", reason: "duplicate_of_existing_name" };
  }

  // Mixed-script junk ("yaunderε" — Latin + a stray Greek letter) or symbols
  // that never appear in a written name: OCR/transcription noise.
  if (!NAME_SAFE_RE.test(cleaned)) {
    if (isHandleShaped(cleaned)) {
      return { action: "relabel", label: "Online handle", value: cleaned, reason: "handle_shaped" };
    }
    return { action: "drop", reason: "not_name_shaped" };
  }

  if (isHandleShaped(cleaned)) {
    return { action: "relabel", label: "Online handle", value: cleaned, reason: "handle_shaped" };
  }

  return { action: "keep", label: canonicalLabel, value: cleaned };
}
