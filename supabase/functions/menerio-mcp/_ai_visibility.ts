// Per-request AI visibility helpers.
// Hidden items and items linked to sensitive persons are filtered out
// of MCP tool responses. Writes against hidden/sensitive items are blocked.
//
// NOTE: column is now `ai_visibility` (renamed from `mcp_visibility`).
// "Hidden" means hidden from ALL AI pipelines (Lexicon, People, Graph,
// AI Chat) and MCP clients. This file kept its old name to avoid churn
// inside menerio-mcp; the semantics are AI-wide.
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
  const [{ data: prefs, error: prefsError }, { data: sensitive, error: sensitiveError }] = await Promise.all([
    supabase.from("mcp_preferences").select("hide_sensitive_from_ai").eq("user_id", userId).maybeSingle(),
    supabase.from("contacts").select("id").eq("user_id", userId).eq("is_sensitive", true).is("merged_into", null),
  ]);
  // Fail closed. A read error used to leave the sensitive set empty, which is
  // exactly "nobody is sensitive": every filter below then let their notes,
  // moments and action items through for the rest of the request.
  const loadError = prefsError ?? sensitiveError;
  if (loadError) throw new Error(`Could not load AI visibility settings: ${loadError.message}. Try again in a moment.`);
  store.hideSensitiveLinked = prefs?.hide_sensitive_from_ai ?? true;
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
 * - Always excludes ai_visibility='hidden'.
 * - For moments (person_id) and action_items (contact_id), excludes rows whose
 *   person is in the sensitive set (when hide_sensitive_from_ai is on).
 */
export async function applyVisibility(
  query: any,
  table: "notes" | "contacts" | "moments" | "action_items" | "collection_items",
  supabase: any,
  userId: string,
) {
  let q = query.eq("ai_visibility", "visible");
  if (table === "contacts") return q;

  if (table === "moments" || table === "action_items") {
    if (await shouldHideSensitiveLinked(supabase, userId)) {
      const ids = await getSensitivePersonIds(supabase, userId);
      if (ids.size > 0) {
        const list = `(${Array.from(ids).join(",")})`;
        // action_items has no person_id; its person is contact_id (the same
        // column ai_can_see checks). Filtering on person_id made PostgREST
        // answer "column does not exist", so get_action_items failed for
        // everyone with at least one sensitive person.
        const column = table === "action_items" ? "contact_id" : "person_id";
        q = q.or(`${column}.is.null,${column}.not.in.${list}`);
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
  const visible = rows.filter((r) => r.ai_visibility !== "hidden");
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
 * Guard a write against a record. Throws a user-friendly error if AI/MCP isn't allowed to touch it.
 */
export async function assertWritable(
  supabase: any,
  userId: string,
  kind: "note" | "contact" | "moment" | "action_item" | "collection_item",
  id: string,
) {
  const { data, error } = await supabase.rpc("ai_can_see", { _user_id: userId, _kind: kind, _id: id });
  if (error) throw new Error(`Visibility check failed: ${error.message}`);
  if (!data) {
    throw new Error(
      `This ${kind.replace("_", " ")} is hidden from AI or belongs to a sensitive person. Unhide it in Menerio to let MCP edit it.`,
    );
  }
}
