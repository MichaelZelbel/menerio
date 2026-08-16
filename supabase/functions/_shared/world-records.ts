/**
 * World rows translated into the three words the hub and the book both use:
 * entity, event, claim.
 *
 * Pure on purpose: no Deno APIs, so a Node test runner can import it. The same
 * reason `hub-source.ts` is pure.
 *
 * The slug is computed here and nowhere else. The hub names its files after it,
 * so if both sides computed it separately they would drift and the hub would
 * write a second file for a thing it already had.
 */

export interface WorldEntity {
  id: string;
  slug: string;
  kind: string;
  name: string;
  aliases: string[];
  description: string | null;
  updated_at: string;
}

export interface WorldEvent {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  date: string | null;
  end_date: string | null;
  participants: string[];
  category: string | null;
  updated_at: string;
}

export interface WorldClaim {
  id: string;
  subject_kind: string;
  subject_id: string | null;
  category: string | null;
  attribute: string;
  value: string;
  object_id: string | null;
  valid_from: string | null;
  valid_to: string | null;
  origin: string;
  rank: string;
  written_by: "human" | "machine";
  evidence_quote: string | null;
  updated_at: string;
}

/** Everything a machine wrote carries an origin that says so. */
export const HUMAN_ORIGINS = new Set(["user_manual"]);

export function writtenBy(origin?: string | null): "human" | "machine" {
  return HUMAN_ORIGINS.has((origin ?? "").trim().toLowerCase()) ? "human" : "machine";
}

// Unicode combining marks. After NFKD an accented letter is a plain letter
// followed by one of these, so dropping them turns "Müller" into "Muller"
// instead of "Mller".
const COMBINING_FIRST = 0x0300;
const COMBINING_LAST = 0x036f;

function stripAccents(text: string): string {
  return text
    .normalize("NFKD")
    .split("")
    .filter((ch) => {
      const code = ch.charCodeAt(0);
      return code < COMBINING_FIRST || code > COMBINING_LAST;
    })
    .join("");
}

/**
 * A filename-safe short id for a name. Returns an empty string when the name
 * has nothing a filename can carry, for example a name written entirely in
 * Chinese. The caller decides what to do then, because only the caller has the
 * record id that makes a fallback unique.
 */
export function slugify(name?: string | null): string {
  return stripAccents(name ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+/, "")
    .replace(/-+$/, "");
}

/** A slug that is never empty and never collides, even for an unnamed row. */
export function slugWithFallback(name: string | null | undefined, id: string, prefix: string): string {
  const slug = slugify(name);
  if (slug) return slug;
  return `${prefix}-${String(id || "").slice(0, 8) || "unknown"}`;
}

/** The date part of a timestamp, which is what an event file is named after. */
export function dateOnly(value?: string | null): string | null {
  if (!value) return null;
  const match = String(value).match(/^(\d{4}-\d{2}-\d{2})/);
  return match ? match[1] : null;
}

export function toWorldEntity(row: Record<string, any>): WorldEntity {
  return {
    id: row.id,
    slug: slugWithFallback(row.name, row.id, "entity"),
    kind: row.kind || "other",
    name: row.name ?? "",
    aliases: Array.isArray(row.aliases) ? row.aliases.filter(Boolean) : [],
    description: row.description ?? null,
    updated_at: row.updated_at ?? row.created_at ?? "",
  };
}

export function toWorldEvent(row: Record<string, any>): WorldEvent {
  const date = dateOnly(row.happened_at);
  return {
    id: row.id,
    slug: `${date ?? "undated"}-${slugWithFallback(row.title, row.id, "event")}`,
    title: row.title ?? "",
    description: row.description ?? null,
    date,
    end_date: dateOnly(row.happened_end),
    participants: row.person_id ? [row.person_id] : [],
    category: row.category ?? null,
    updated_at: row.updated_at ?? row.created_at ?? "",
  };
}

export function toWorldClaim(row: Record<string, any>): WorldClaim {
  return {
    id: row.id,
    subject_kind: row.subject_kind ?? "self",
    subject_id: row.subject_id ?? null,
    category: row.category ?? null,
    attribute: row.attribute ?? "",
    value: row.value ?? "",
    object_id: row.object_id ?? null,
    valid_from: dateOnly(row.valid_from),
    valid_to: dateOnly(row.valid_to),
    origin: row.origin ?? "unverified",
    rank: row.rank ?? "normal",
    written_by: writtenBy(row.origin),
    evidence_quote: row.evidence_quote ?? null,
    updated_at: row.updated_at ?? row.created_at ?? "",
  };
}

/**
 * `updated_since` makes a rerun cheap. A value that is not a timestamp is
 * refused rather than ignored, because ignoring it would quietly return the
 * whole world to a caller who asked for one day of it.
 */
export function parseUpdatedSince(raw?: string | null): { value: string | null; error: string | null } {
  if (raw === null || raw === undefined || raw.trim() === "") return { value: null, error: null };
  const text = raw.trim();
  const stamp = /^\d{4}-\d{2}-\d{2}$/.test(text) ? `${text}T00:00:00Z` : text;
  const parsed = new Date(stamp);
  if (Number.isNaN(parsed.getTime())) {
    return { value: null, error: `updated_since must be a date or timestamp, got "${raw}"` };
  }
  return { value: parsed.toISOString(), error: null };
}

/** A page size a caller cannot use to ask for everything at once by accident. */
export function parseLimit(raw?: string | null, fallback = 500, max = 2000): number {
  const n = parseInt(raw ?? "", 10);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(n, max);
}
