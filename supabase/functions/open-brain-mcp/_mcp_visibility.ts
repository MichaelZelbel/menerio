// Per-request MCP visibility helpers.
// Hidden items and items linked to sensitive persons are filtered out
// of MCP tool responses. Writes against hidden/sensitive items are blocked.
import { AsyncLocalStorage } from "node:async_hooks";

const cache = new AsyncLocalStorage<{
  sensitivePersonIds?: Set<string>;
  hideSensitiveLinked?: boolean;
  loaded?: boolean;
}>();

export function enterVisibilityScope<T>(fn: () => Promise<T> | T): Promise<T> | T {
  return cache.run({}, fn);
}

async function ensureLoaded(supabase: any, userId: string) {
  const store = cache.getStore();
  if (!store || store.loaded) return store;
  const [{ data: prefs }, { data: sensitive }] = await Promise.all([
    supabase.from("mcp_preferences").select("hide_sensitive_linked").eq("user_id", userId).maybeSingle(),
    supabase.from("contacts").select("id").eq("user_id", userId).eq("is_sensitive", true).is("merged_into", null),
  ]);
  store.hideSensitiveLinked = prefs?.hide_sensitive_linked ?? true;
  store.sensitivePersonIds = new Set((sensitive ?? []).map((r: any) => r.id));
  store.loaded = true;
  return store;
}

export async function getSensitivePersonIds(supabase: any, userId: string): Promise<Set<string>> {
  const store = await ensureLoaded(supabase, userId);
  return store?.sensitivePersonIds ?? new Set<string>();
}

export async function shouldHideSensitiveLinked(supabase: any, userId: string): Promise<boolean> {
  const store = await ensureLoaded(supabase, userId);
  return store?.hideSensitiveLinked ?? true;
}

/**
 * Apply visibility filters to a Supabase query builder.
 * - Always excludes mcp_visibility='hidden'.
 * - For tables with a person_id column (notes/moments/action_items), excludes rows
 *   whose person_id is in the sensitive set (when hide_sensitive_linked is on).
 */
export async function applyVisibility(
  query: any,
  table: "notes" | "contacts" | "moments" | "action_items" | "collection_items",
  supabase: any,
  userId: string,
) {
  let q = query.eq("mcp_visibility", "visible");
  if (table === "contacts") return q;

  if (table === "notes" || table === "moments" || table === "action_items") {
    if (await shouldHideSensitiveLinked(supabase, userId)) {
      const ids = await getSensitivePersonIds(supabase, userId);
      if (ids.size > 0) {
        const list = `(${Array.from(ids).join(",")})`;
        q = q.or(`person_id.is.null,person_id.not.in.${list}`);
      }
    }
  }
  return q;
}

/**
 * Post-filter an already-fetched array of notes by matched_people sensitivity.
 * Used by semantic search where filters can't easily express jsonb membership.
 */
export async function filterVisibleNotes(rows: any[], supabase: any, userId: string): Promise<any[]> {
  if (!rows?.length) return rows;
  const visible = rows.filter((r) => r.mcp_visibility !== "hidden");
  if (!(await shouldHideSensitiveLinked(supabase, userId))) return visible;
  const ids = await getSensitivePersonIds(supabase, userId);
  if (ids.size === 0) return visible;
  return visible.filter((r) => {
    if (r.person_id && ids.has(r.person_id)) return false;
    const matched = r?.metadata?.matched_people;
    if (Array.isArray(matched) && matched.some((id: string) => ids.has(id))) return false;
    return true;
  });
}

/**
 * Strip PII from a contact row when the contact is sensitive.
 * Kept fields: id, name, relationship (so AI can still know "this person exists").
 */
export function redactSensitiveContact<T extends Record<string, any>>(row: T | null | undefined): T | null {
  if (!row) return row ?? null;
  if (!row.is_sensitive) return row;
  return {
    id: row.id,
    name: row.name,
    relationship: row.relationship ?? null,
    is_sensitive: true,
    _redacted: "PII hidden — contact is marked sensitive in Menerio. Unmark in the Person profile to allow AI access.",
  } as unknown as T;
}

export function redactContactList<T extends Record<string, any>>(rows: T[] | null | undefined): T[] {
  if (!rows) return [];
  return rows.map((r) => redactSensitiveContact(r) as T);
}

/**
 * Guard a write against a record. Throws a user-friendly error if MCP isn't allowed to touch it.
 */
export async function assertWritable(
  supabase: any,
  userId: string,
  kind: "note" | "contact" | "moment" | "action_item" | "collection_item",
  id: string,
) {
  const { data, error } = await supabase.rpc("mcp_can_see", { _user_id: userId, _kind: kind, _id: id });
  if (error) throw new Error(`Visibility check failed: ${error.message}`);
  if (!data) {
    throw new Error(
      `This ${kind.replace("_", " ")} is hidden from AI or belongs to a sensitive person. Unhide it in Menerio to let MCP edit it.`,
    );
  }
}
