/**
 * "Hidden from AI" for the key-authenticated Mission Control REST API.
 *
 * A Mission Control API key is machine access for the owner's AI agents, the
 * same audience the MCP server serves. The MCP server (menerio-mcp/
 * _ai_visibility.ts) and mc-api-world already left out rows marked
 * ai_visibility = 'hidden' and people marked sensitive; mc-api-notes,
 * mc-api-contacts and mc-api-actions answered with all of them, so a note the
 * owner had hidden from every AI came straight back through the same key.
 *
 * The owner's own app reads through RLS, not through these endpoints, and is
 * not affected.
 *
 * No Deno APIs, so the Node test runner can import this directly.
 */

import { isGodspeedMirror } from "./mc-source.ts";

// deno-lint-ignore no-explicit-any
type Db = any;

export interface McVisibility {
  /** hide_sensitive_from_ai, default on. */
  hideSensitive: boolean;
  /** Contacts marked sensitive (non-merged). */
  sensitiveIds: Set<string>;
}

/** Fails closed: an unread error must not read as "nobody is sensitive". */
export async function loadMcVisibility(db: Db, userId: string): Promise<McVisibility> {
  const [{ data: prefs, error: prefsError }, { data: sensitive, error: sensitiveError }] = await Promise.all([
    db.from("mcp_preferences").select("hide_sensitive_from_ai").eq("user_id", userId).maybeSingle(),
    db.from("contacts").select("id").eq("user_id", userId).eq("is_sensitive", true).is("merged_into", null),
  ]);
  const err = prefsError ?? sensitiveError;
  if (err) throw new Error(`Could not load AI visibility settings: ${err.message}`);
  return {
    hideSensitive: prefs?.hide_sensitive_from_ai ?? true,
    sensitiveIds: new Set(((sensitive ?? []) as { id: string }[]).map((r) => r.id)),
  };
}

/** Query filter every read of notes, contacts and action items goes through. */
export function notHidden<Q>(query: Q): Q {
  // deno-lint-ignore no-explicit-any
  return (query as any).neq("ai_visibility", "hidden");
}

/** The sensitive set in effect (empty when the owner turned the gate off). */
function activeSensitive(v: McVisibility): Set<string> {
  return v.hideSensitive ? v.sensitiveIds : new Set();
}

/**
 * The contact ids a note's `metadata.matched_people` names.
 *
 * process-note, enrich-people and the contact merge store each entry as an
 * object, `{ name, contact_id, canonical_name }` (or `{ name, is_self }` for
 * the owner). The check below used to compare `String(entry)` with the
 * sensitive ids, and `String({...})` is "[object Object]": no real note ever
 * matched, so a note about a person marked sensitive came back through every
 * endpoint here. A bare id string is still read as an id.
 */
export function matchedContactIds(matched: unknown): string[] {
  if (!Array.isArray(matched)) return [];
  const ids: string[] = [];
  for (const entry of matched) {
    if (typeof entry === "string") {
      if (entry) ids.push(entry);
    } else if (entry && typeof entry === "object") {
      const id = (entry as { contact_id?: unknown }).contact_id;
      if (typeof id === "string" && id) ids.push(id);
    }
  }
  return ids;
}

/**
 * A note row the key may see: not hidden, and not about a sensitive person.
 *
 * A mirrored mission control file is the exception to the second rule. It is a
 * copy of a file Mission Control wrote and still holds, so leaving it out hides
 * nothing, while its sync reads, updates and re-creates these notes through this
 * API: 597 of 1,223 mirror notes name someone (2026-09-30), and marking one of
 * those people sensitive would have made each of them vanish from the list and
 * answer 404 to every update. "Hidden from AI" set on the note itself still holds.
 */
export function noteIsVisible(
  row: {
    ai_visibility?: string | null;
    source_app?: string | null;
    metadata?: { matched_people?: unknown } | null;
  } | null | undefined,
  v: McVisibility,
): boolean {
  if (!row || row.ai_visibility === "hidden") return false;
  if (isGodspeedMirror(row.source_app)) return true;
  const ids = activeSensitive(v);
  if (ids.size > 0 && matchedContactIds(row.metadata?.matched_people).some((id) => ids.has(id))) return false;
  return true;
}

/** An action item the key may see: not hidden, not about a sensitive person. */
export function actionIsVisible(
  row: { ai_visibility?: string | null; contact_id?: string | null } | null | undefined,
  v: McVisibility,
): boolean {
  if (!row || row.ai_visibility === "hidden") return false;
  return !(row.contact_id && activeSensitive(v).has(row.contact_id));
}

/** PostgREST filter value excluding action items linked to a sensitive person, or null. */
export function sensitiveContactExclusion(v: McVisibility): string | null {
  const ids = Array.from(activeSensitive(v));
  if (ids.length === 0) return null;
  return `contact_id.is.null,contact_id.not.in.(${ids.join(",")})`;
}

/**
 * A sensitive contact keeps only what the MCP server keeps: id, name and
 * relationship, so an agent knows the person exists and nothing more.
 */
export function redactContact<T extends Record<string, unknown>>(row: T, v: McVisibility): T {
  if (!v.hideSensitive || !row?.id || !v.sensitiveIds.has(String(row.id))) return row;
  return {
    id: row.id,
    name: row.name,
    relationship: row.relationship ?? null,
    is_sensitive: true,
    _redacted: "PII hidden: this contact is marked sensitive in Menerio.",
  } as unknown as T;
}
