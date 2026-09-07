import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

export const topicPriority = z.enum(["high", "normal", "low"]);
export const topicMode = z.enum(["one_off", "recurring"]);
export const topicPatch = z.object({ title: z.string().trim().min(1).max(300).optional(), mode: topicMode.optional(), priority: topicPriority.optional() }).strict().refine(p => Object.keys(p).length > 0, "Patch cannot be empty");
export class TopicError extends Error {
  constructor(public code: string, message: string, public details?: unknown) { super(message); }
}
export function checkTopicError(error: { code?: string; message: string; details?: string } | null) {
  if (!error) return;
  const code = error.code === "40001" ? "VERSION_CONFLICT" : error.code === "42501" ? "NOT_ACCESSIBLE" : error.code === "22023" ? "INVALID_COMMAND" : ["42P01", "42883", "PGRST202", "PGRST205"].includes(error.code ?? "") ? "FEATURE_UNAVAILABLE" : "DATABASE_ERROR";
  throw new TopicError(code, code === "DATABASE_ERROR" ? "Topic operation failed. Nothing has been confirmed saved." : error.message, code === "VERSION_CONFLICT" ? error.details : undefined);
}
export const personTopicUrl = (id: string) => `https://menerio.com/dashboard/people/${id}`;
export const encodeTopicCursor = (value: unknown) => btoa(Array.from(new TextEncoder().encode(JSON.stringify(value)), byte => String.fromCharCode(byte)).join(""));
export const decodeTopicCursor = (value: string) => JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Uint8Array.from(atob(value), char => char.charCodeAt(0))));

export async function searchContextPeople(db: SupabaseClient, owner: string, name: string, limit = 21, relationship?: string) {
  const needle = name.trim().toLocaleLowerCase();
  const matches: Record<string, any>[] = [];
  // Read stable bounded pages rather than silently dropping aliases after a
  // server row cap. PostgREST cannot apply ILIKE to a text[] alias element.
  for (let offset = 0; ; offset += 500) {
    let q = db.from("contacts").select("*").eq("user_id", owner).is("merged_into", null).eq("ai_visibility", "visible");
    if (relationship) q = q.eq("relationship", relationship);
    const { data, error } = await q.order("id").range(offset, offset + 499);
    checkTopicError(error);
    for (const c of data ?? []) {
      const values = c.is_sensitive ? [c.name] : [c.name, c.company, ...(c.aliases ?? [])];
      if (values.some(v => String(v ?? "").toLocaleLowerCase().includes(needle))) matches.push(c);
      if (matches.length >= limit) return matches;
    }
    if (!data || data.length < 500) return matches;
  }
}

export async function resolveContextPerson(db: SupabaseClient, owner: string, contactId?: string, name?: string) {
  if (!contactId && !name?.trim()) throw new TopicError("INVALID_INPUT", "Provide a name or contact_id.");
  let data: Record<string, any>[];
  if (contactId) {
    const result = await db.from("contacts").select("*").eq("user_id", owner).is("merged_into", null).eq("ai_visibility", "visible").eq("id", contactId).limit(1);
    checkTopicError(result.error); data = result.data ?? [];
  } else data = await searchContextPeople(db, owner, name!, 21);
  if (!data?.length) return { error: "NOT_FOUND", message: "No contact found." };
  if (data.length > 1) return { error: "AMBIGUOUS_PERSON", message: "Choose a contact_id before continuing.", candidates: data.slice(0, 20).map(c => ({ id: c.id, name: c.name })), more_candidates: data.length > 20 };
  return { contact: data[0] };
}

/** Fail closed on ownership, merged contacts, hidden contacts, and sensitive contacts. */
export async function requireTopicPerson(db: SupabaseClient, owner: string, id: string) {
  const { data, error } = await db.from("contacts").select("id,name,is_sensitive,ai_visibility,merged_into").eq("id", id).eq("user_id", owner).maybeSingle();
  checkTopicError(error);
  if (!data || data.merged_into || data.ai_visibility !== "visible" || data.is_sensitive) throw new TopicError("NOT_ACCESSIBLE", "This person is not accessible to AI.");
  const visibility = await db.rpc("ai_can_see", { _user_id: owner, _kind: "contact", _id: id });
  checkTopicError(visibility.error);
  if (!visibility.data) throw new TopicError("NOT_ACCESSIBLE", "This person is not accessible to AI.");
  return data;
}
export async function requireTopic(db: SupabaseClient, owner: string, id: string) {
  const { data, error } = await db.from("contact_topics").select("*").eq("user_id", owner).eq("id", id).maybeSingle();
  checkTopicError(error);
  if (!data) throw new TopicError("NOT_ACCESSIBLE", "This topic is not accessible.");
  await requireTopicPerson(db, owner, data.contact_id);
  return data;
}

const cursorSchema = z.object({ contact: z.string().uuid(), status: z.string(), query: z.string(), priority: topicPriority, created: z.string().datetime({ offset: true }), id: z.string().uuid() }).strict();
export async function listTopics(db: SupabaseClient, owner: string, args: { contact_id: string; status?: string; query?: string; cursor?: string; limit?: number }) {
  await requireTopicPerson(db, owner, args.contact_id);
  const status = args.status ?? "active", query = args.query ?? "", limit = Math.min(args.limit ?? 20, 100);
  let q = db.from("contact_topics").select("*", { count: "exact" }).eq("user_id", owner).eq("contact_id", args.contact_id).eq("status", status);
  if (query) q = q.ilike("title", `%${query.replace(/[\\%_]/g, c => `\\${c}`)}%`);
  // Text values sort high, low, normal; query each priority bucket to implement product ordering.
  let cursor: z.infer<typeof cursorSchema> | undefined;
  if (args.cursor) {
    try { cursor = cursorSchema.parse(decodeTopicCursor(args.cursor)); } catch { throw new TopicError("INVALID_CURSOR", "Invalid topic cursor."); }
    if (cursor.contact !== args.contact_id || cursor.status !== status || cursor.query !== query) throw new TopicError("INVALID_CURSOR", "Cursor does not match this topic list.");
  }
  const priorities = ["high", "normal", "low"];
  const rows: Record<string, any>[] = [];
  const countResult = await q.limit(0);
  checkTopicError(countResult.error);
  for (const priority of priorities) {
    if (cursor && priorities.indexOf(priority) < priorities.indexOf(cursor.priority)) continue;
    let bucket = db.from("contact_topics").select("*").eq("user_id", owner).eq("contact_id", args.contact_id).eq("status", status).eq("priority", priority);
    if (query) bucket = bucket.ilike("title", `%${query.replace(/[\\%_]/g, c => `\\${c}`)}%`);
    if (cursor?.priority === priority) bucket = bucket.or(`created_at.gt.${cursor.created},and(created_at.eq.${cursor.created},id.gt.${cursor.id})`);
    const result = await bucket.order("created_at").order("id").limit(limit + 1 - rows.length);
    checkTopicError(result.error); rows.push(...(result.data ?? []));
    if (rows.length > limit) break;
  }
  const hasMore = rows.length > limit, topics = rows.slice(0, limit), last = topics.at(-1);
  return { topics, total: countResult.count ?? 0, next_cursor: hasMore && last ? encodeTopicCursor({ contact: args.contact_id, status, query, priority: last.priority, created: last.created_at, id: last.id }) : null, person_url: personTopicUrl(args.contact_id) };
}

export async function topicContext(db: SupabaseClient, owner: string, contactId: string): Promise<string> {
  try {
    const result = await listTopics(db, owner, { contact_id: contactId, limit: 5 });
    return ["## Topics to talk about", `${result.total} active`, ...result.topics.map(t => `- [${t.priority}] ${t.title} (${t.mode === "recurring" ? "recurring" : "one-off"}; id: ${t.id}; version: ${t.version}${t.last_discussed_at ? `; last discussed ${t.last_discussed_at}` : ""})`), `More: list_contact_topics(contact_id="${contactId}"). ${result.person_url}`].join("\n");
  } catch (error) {
    if (error instanceof TopicError && error.code === "FEATURE_UNAVAILABLE") return "## Topics to talk about\nTopics are not available yet.";
    throw error;
  }
}

export async function applyTopicCommand(db: SupabaseClient, owner: string, requestId: string, command: Record<string, unknown>) {
  // The service-only wrapper checks the current person under the same database
  // lock as the mutation, including a replay after a merge. The original
  // request/receipt can legitimately still name the merged-away person.
  const { data, error } = await db.rpc("apply_contact_topic_command_for_user", { p_user_id: owner, p_request_id: requestId, p_command: command });
  checkTopicError(error);
  if (!data?.topic || !data.event_id) throw new TopicError("DATABASE_ERROR", "Topic response was incomplete.");
  // A merge may have moved the record while the command waited on its database lock.
  const current = await requireTopic(db, owner, data.topic.id);
  return { ...data, person_url: personTopicUrl(current.contact_id) };
}
