import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { applyTopicCommand, checkTopicError, listTopics, personTopicUrl, requireTopic, TopicError, topicMode, topicPatch, topicPriority } from "../_shared/contact-topics.ts";

export const CONTACT_TOPIC_SCOPES = Object.fromEntries([
  "list_contact_topics", "get_contact_topic_history", "create_contact_topic", "update_contact_topic", "discuss_contact_topic", "archive_contact_topic", "reopen_contact_topic", "undo_contact_topic_event",
].map(name => [name, "contacts"]));
const id = z.string().uuid();
const mutation = { topic_id: id, expected_version: z.number().int().positive(), request_id: id };
const page = { cursor: z.string().max(4096).optional(), limit: z.number().int().min(1).max(100).default(20) };
const historyCursor = z.object({ topic: id, created: z.string().datetime({ offset: true }), id }).strict();
const success = (value: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(value) }] });
const failure = (error: unknown) => ({ ...success({ error: { code: error instanceof TopicError ? error.code : error instanceof z.ZodError ? "INVALID_INPUT" : "DATABASE_ERROR", message: error instanceof TopicError || error instanceof z.ZodError ? error.message : "Topic operation failed. Nothing has been confirmed saved.", ...(error instanceof TopicError && error.details ? { details: error.details } : {}) } }), isError: true });

/** Register after the application's scope wrapper so these share its authenticated call path. */
export function registerContactTopicTools(server: McpServer, db: SupabaseClient, userId: () => string) {
  function register(shape: z.ZodRawShape, name: string, description: string, run: (args: any) => Promise<unknown>) {
    server.registerTool(name, { description, inputSchema: shape }, async args => {
      try { return success(await run(z.object(shape).strict().parse(args))); } catch (error) { return failure(error); }
    });
  }
  register({ contact_id: id, status: z.enum(["active", "completed", "archived"]).default("active"), query: z.string().max(300).optional(), ...page }, "list_contact_topics", "List a resolved person's topics, ordered High, Normal, Low then oldest first. Follow next_cursor for more.", args => listTopics(db, userId(), args));
  register({ topic_id: id, ...page }, "get_contact_topic_history", "Read immutable topic events, newest first. Discussion snapshots retain their original wording; reversal events identify undone operations.", async args => {
    const owner = userId(), topic = await requireTopic(db, owner, args.topic_id);
    let q = db.from("contact_topic_events").select("*").eq("user_id", owner).eq("topic_id", args.topic_id);
    if (args.cursor) {
      let c: z.infer<typeof historyCursor>;
      try { c = historyCursor.parse(JSON.parse(atob(args.cursor))); } catch { throw new TopicError("INVALID_CURSOR", "Invalid history cursor."); }
      if (c.topic !== args.topic_id) throw new TopicError("INVALID_CURSOR", "Cursor belongs to another topic.");
      q = q.or(`created_at.lt.${c.created},and(created_at.eq.${c.created},id.lt.${c.id})`);
    }
    const { data, error } = await q.order("created_at", { ascending: false }).order("id", { ascending: false }).limit(args.limit + 1);
    checkTopicError(error);
    const events = (data ?? []).slice(0, args.limit), last = events.at(-1);
    return { events, next_cursor: data && data.length > args.limit && last ? btoa(JSON.stringify({ topic: args.topic_id, created: last.created_at, id: last.id })) : null, person_url: personTopicUrl(topic.contact_id) };
  });
  const command = (action: string) => async ({ request_id, ...args }: Record<string, unknown>) => applyTopicCommand(db, userId(), String(request_id), { action, ...args });
  register({ contact_id: id, title: z.string().trim().min(1).max(300), mode: topicMode.default("one_off"), priority: topicPriority.default("normal"), request_id: id }, "create_contact_topic", "Create a native topic for an exact person ID. Keep the same request_id and payload on a timeout retry.", command("create"));
  register({ ...mutation, patch: topicPatch }, "update_contact_topic", "Edit title, priority, or repetition at the current version. Stale versions are refused.", command("update"));
  register({ ...mutation, discussed_at: z.string().datetime({ offset: true }).optional(), close_after: z.boolean().default(false) }, "discuss_contact_topic", "Record a discussion. One-off completes; recurring remains active unless close_after is true. Optional discussed_at must be in the past.", command("discuss"));
  register(mutation, "archive_contact_topic", "Stop bringing up a topic without claiming it was discussed.", command("archive"));
  register(mutation, "reopen_contact_topic", "Restore a completed or archived topic, preserving history.", command("reopen"));
  register({ ...mutation, event_id: id }, "undo_contact_topic_event", "Reverse only the latest reversible event at the current version, preserving the audit record.", command("undo"));
}
