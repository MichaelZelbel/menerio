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

/** A note row the key may see: not hidden, and not about a sensitive person. */
export function noteIsVisible(
  row: { ai_visibility?: string | null; metadata?: { matched_people?: unknown } | null } | null | undefined,
  v: McVisibility,
): boolean {
  if (!row || row.ai_visibility === "hidden") return false;
  const ids = activeSensitive(v);
  const matched = row.metadata?.matched_people;
  if (ids.size > 0 && Array.isArray(matched) && matched.some((id) => ids.has(String(id)))) return false;
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
