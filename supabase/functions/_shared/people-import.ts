/**
 * Deterministic person planner for imports and the "Create people from notes"
 * action.
 *
 * Pure module (no Deno / no network) so the edge function and the frontend test
 * suite share exactly one implementation. Given notes and the existing
 * contacts, it decides which people to create, which notes to link to an
 * existing person, and why anything was skipped.
 */

export interface ExistingContact {
  id: string;
  name: string;
  aliases?: string[] | null;
}

export interface PersonNoteSource {
  id: string;
  title?: string | null;
  content?: string | null;
  metadata?: Record<string, unknown> | null;
}

export interface PlannedPerson {
  name: string;
  note_ids: string[];
}

export interface PlannedLink {
  contact_id: string;
  name: string;
  note_ids: string[];
}

export interface PeoplePlan {
  create: PlannedPerson[];
  link: PlannedLink[];
  skipped: { name: string; reason: string }[];
}

/** Words that are never a person, even when capitalised mid-sentence. */
const NON_PERSON_WORDS = new Set([
  "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday",
  "january", "february", "march", "april", "may", "june", "july", "august",
  "september", "october", "november", "december",
  "people", "projects", "preferences", "decisions", "professional", "personal",
  "context", "notes", "note", "team", "company", "project", "menerio", "google",
  "chatgpt", "claude", "openai", "slack", "notion", "github", "email", "ai",
  "i", "me", "my", "we", "they", "he", "she", "it", "the", "this", "that",
]);

/** Phrases that mark the sentence as being about a person. */
const PERSON_CUES = [
  /\b(?:my|our|his|her|their)\s+(?:wife|husband|partner|girlfriend|boyfriend|manager|boss|colleague|coworker|co-worker|friend|mentor|client|assistant|doctor|neighbou?r|brother|sister|mother|father|mum|mom|dad|son|daughter|cousin|teammate|lead)\b/i,
  /\b(?:works?|worked|reports?|prefers?|likes?|dislikes?|wants?|asked|said|told|leads?|manages?|mentors?|introduced|met)\b/i,
  /\b(?:is|was)\s+(?:my|our|a|an|the)\b/i,
];

const NAME_RE = /\b\p{Lu}[\p{Ll}'’-]+(?:\s+\p{Lu}[\p{Ll}'’-]+)?\b/gu;

export function normalizeName(name: string): string {
  return name.trim().replace(/\s+/g, " ").toLowerCase();
}

/**
 * Names a note is about. Uses the LLM-extracted `metadata.people` /
 * `metadata.matched_people` when present, and otherwise falls back to a
 * conservative scan that only accepts capitalised names in sentences carrying
 * an explicit person cue.
 */
export function collectPersonNames(note: PersonNoteSource): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (value: unknown) => {
    if (typeof value !== "string") return;
    const name = value.trim().replace(/\s+/g, " ");
    if (!name || name.length < 2) return;
    const key = normalizeName(name);
    if (NON_PERSON_WORDS.has(key)) return;
    if (seen.has(key)) return;
    seen.add(key);
    out.push(name);
  };

  const meta = (note.metadata ?? {}) as Record<string, unknown>;
  if (Array.isArray(meta.people)) meta.people.forEach(push);
  if (Array.isArray(meta.matched_people)) {
    for (const m of meta.matched_people as Array<Record<string, unknown>>) {
      if (m && m.is_self !== true) push(m.canonical_name ?? m.name);
    }
  }

  if (out.length === 0) {
    const text = `${note.title ?? ""}. ${note.content ?? ""}`;
    for (const sentence of text.split(/(?<=[.!?;\n])\s+/)) {
      if (!PERSON_CUES.some((re) => re.test(sentence))) continue;
      const words = sentence.trim().split(/\s+/);
      for (const match of sentence.matchAll(NAME_RE)) {
        const candidate = match[0];
        // Skip a capitalised first word of the sentence — usually not a name.
        if (words[0] && words[0].replace(/[^\p{L}'’-]/gu, "") === candidate) continue;
        push(candidate);
      }
    }
  }

  return out;
}

function buildIndex(contacts: ExistingContact[]): Map<string, ExistingContact> {
  const index = new Map<string, ExistingContact>();
  for (const c of contacts) {
    index.set(normalizeName(c.name), c);
    for (const alias of c.aliases ?? []) {
      if (alias) index.set(normalizeName(alias), c);
    }
  }
  return index;
}

/**
 * Plan person creation across a set of notes. The same name across many notes
 * is always one person: creations are keyed on the normalized name.
 */
export function planPeopleFromNotes(
  notes: PersonNoteSource[],
  existing: ExistingContact[],
  options: { selfAliases?: string[] } = {},
): PeoplePlan {
  const index = buildIndex(existing);
  const selfKeys = new Set((options.selfAliases ?? []).map(normalizeName));

  const creates = new Map<string, PlannedPerson>();
  const links = new Map<string, PlannedLink>();
  const skipped: { name: string; reason: string }[] = [];
  const skippedSeen = new Set<string>();

  for (const note of notes) {
    for (const name of collectPersonNames(note)) {
      const key = normalizeName(name);
      if (selfKeys.has(key)) {
        if (!skippedSeen.has(key)) { skippedSeen.add(key); skipped.push({ name, reason: "refers to you" }); }
        continue;
      }
      const match = index.get(key);
      if (match) {
        const link = links.get(match.id) ?? { contact_id: match.id, name: match.name, note_ids: [] };
        if (!link.note_ids.includes(note.id)) link.note_ids.push(note.id);
        links.set(match.id, link);
        continue;
      }
      const planned = creates.get(key) ?? { name, note_ids: [] };
      if (!planned.note_ids.includes(note.id)) planned.note_ids.push(note.id);
      creates.set(key, planned);
    }
  }

  return { create: [...creates.values()], link: [...links.values()], skipped };
}

/** Human-readable outcome, so the UI never ends in silence. */
export function describePeopleResult(result: {
  created: number;
  linked: number;
  notes_scanned: number;
  skipped?: number;
}): string {
  const parts: string[] = [];
  if (result.created > 0) parts.push(`Created ${result.created} ${result.created === 1 ? "person" : "people"}`);
  if (result.linked > 0) parts.push(`linked ${result.linked} existing ${result.linked === 1 ? "person" : "people"} to notes`);
  if (parts.length > 0) return `${parts.join(", ")}.`;
  if (result.notes_scanned === 0) return "Nothing to scan — no notes were found for your account.";
  if (result.skipped && result.skipped > 0) {
    return `No new people. Scanned ${result.notes_scanned} notes; every name found was already in your People list or referred to you.`;
  }
  return `No people found. Scanned ${result.notes_scanned} notes and none of them named a person.`;
}
