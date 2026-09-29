// What Mira (conversation-chat) may be told about the person on the page.
//
// Marking a person sensitive promises "hidden from all AI features, linked
// notes and moments too" (AiVisibilityButton). This chat used to send that
// person's contact notes, memory documents, related notes and moments to the
// model anyway, and for everyone else it sent moments hidden from AI and
// notes about other sensitive people. The rules below are the same the MCP
// server and the REST API apply (menerio-mcp/_ai_visibility.ts,
// _shared/mc-visibility.ts): a hidden or sensitive person is a name and
// nothing more; a note or moment linked to one is left out.
//
// Pure TypeScript with no Deno APIs, so the Node test runner imports it.

import { labelOf, sectionOf, uniqueFacts, type FactRow } from "../_shared/agent-facts.ts";
import { matchedContactIds } from "../_shared/mc-visibility.ts";

export interface PersonRow {
  id: string;
  name: string;
  notes?: string | null;
  tags?: string[] | null;
  aliases?: string[] | null;
  is_sensitive?: boolean | null;
  ai_visibility?: string | null;
}

export interface NoteRow {
  title: string | null;
  created_at: string | null;
  ai_visibility?: string | null;
  metadata?: { people?: unknown; matched_people?: unknown } | null;
}

export interface MomentRow {
  title: string | null;
  description: string | null;
  happened_at: string | null;
  person_id?: string | null;
  ai_visibility?: string | null;
}

/** The person themself is off limits to the model. */
export function personHiddenFromAi(person: PersonRow | null | undefined): boolean {
  if (!person) return false;
  return person.is_sensitive === true || (person.ai_visibility ?? "visible") !== "visible";
}

function namesOf(person: PersonRow): string[] {
  return [person.name, ...(person.aliases || [])].filter(Boolean).map((n) => String(n).toLowerCase());
}

/**
 * Notes that name this person, minus any note hidden from AI or linked to a
 * hidden or sensitive person. `hiddenPeople` null means the set could not be
 * read: then nothing is returned (fail closed).
 */
export function relatedNotesFor(
  notes: NoteRow[],
  person: PersonRow,
  hiddenPeople: Set<string> | null,
  max = 10,
): NoteRow[] {
  if (!hiddenPeople) return [];
  const names = namesOf(person);
  return notes.filter((note) => {
    if ((note.ai_visibility ?? "visible") !== "visible") return false;
    // Each matched_people entry is an object ({ name, contact_id, canonical_name });
    // compared as a plain id it never matched, and every such note went through.
    if (matchedContactIds(note.metadata?.matched_people).some((id) => hiddenPeople.has(id))) return false;
    const people = note.metadata?.people;
    return Array.isArray(people) && names.some((name) => people.some((p) => String(p).toLowerCase() === name));
  }).slice(0, max);
}

/** Moments that mention this person, with the same exclusions as notes. */
export function relatedMomentsFor(
  moments: MomentRow[],
  person: PersonRow,
  hiddenPeople: Set<string> | null,
  max = 10,
): MomentRow[] {
  if (!hiddenPeople) return [];
  const names = namesOf(person);
  return moments.filter((m) => {
    if ((m.ai_visibility ?? "visible") !== "visible") return false;
    if (m.person_id && hiddenPeople.has(m.person_id)) return false;
    const text = `${m.title || ""} ${m.description || ""}`.toLowerCase();
    return names.some((name) => text.includes(name));
  }).slice(0, max);
}

/** The only context a hidden or sensitive person gets: their name, and why nothing else. */
export function hiddenPersonContext(person: PersonRow): string {
  return `## Person Context\nName: ${person.name}\n` +
    "The user has hidden this person from AI in Menerio, so no stored notes, facts, moments or memories " +
    "about them are available to you. Do not look them up with your tools. Work only from what the user " +
    "writes or attaches in this chat, and do not guess at stored details.\n";
}

export function buildPersonContext(person: PersonRow | null, facts: FactRow[], notes: NoteRow[], moments: MomentRow[]): string {
  if (!person) return "";
  if (personHiddenFromAi(person)) return hiddenPersonContext(person);
  let ctx = `## Person Context\nName: ${person.name}\n`;
  if (person.aliases?.length) ctx += `Aliases: ${person.aliases.join(", ")}\n`;
  if (person.tags?.length) ctx += `Tags: ${person.tags.join(", ")}\n`;
  if (person.notes) ctx += `Notes: ${person.notes}\n`;
  if (facts.length) {
    ctx += "\n### Profile\n";
    for (const fact of uniqueFacts(facts)) {
      ctx += `- ${sectionOf(fact).name}: ${labelOf(fact)} — ${fact.value}${fact.has_conflict ? " (one of two current answers; report both)" : ""}\n`;
    }
  }
  if (moments.length) {
    ctx += "\n### Related Moments\n";
    for (const m of moments) ctx += `- ${m.happened_at}: ${m.title}${m.description ? ` — ${m.description}` : ""}\n`;
  }
  if (notes.length) {
    ctx += "\n### Related Notes\n";
    for (const n of notes) ctx += `- ${n.title} (${n.created_at})\n`;
  }
  return ctx;
}
