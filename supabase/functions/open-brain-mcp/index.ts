import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPTransport } from "@hono/mcp";
import { Hono } from "hono";
import { z } from "zod";
import { createClient } from "@supabase/supabase-js";
import { openRouterWithCredits } from "../_shared/llm-credits.ts";
import { importGroupMembersFromNotes, previewGroupMembersFromNotes } from "../_shared/group-note-import.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const OPENROUTER_API_KEY = Deno.env.get("OPENROUTER_API_KEY")!;
const OPENROUTER_BASE = "https://openrouter.ai/api/v1";
const MCP_TOKEN_PREFIX = "mnr_mcp_";
const MCP_TOKEN_PATTERN = /^mnr_mcp_[A-Za-z0-9_-]{43}$/;
const INVALID_TOKEN_FORMAT_MESSAGE =
  "Invalid token format. This MCP server only accepts long-lived personal MCP tokens (prefix `mnr_mcp_`). Create one in Settings → MCP Server.";
const HUB_KEY_USED_MESSAGE =
  "You used a Hub API key (prefix `mnr_`). The MCP server needs a separate Personal MCP Token (prefix `mnr_mcp_`). Create one in Menerio → Settings → MCP Server.";

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// Per-request user ID — set before each MCP request is handled
let currentUserId = "";

async function sha256Hex(value: string) {
  const hashBuffer = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(hashBuffer)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function extractBearerToken(authHeader: string | undefined) {
  if (!authHeader) return "";
  const trimmed = authHeader
    .trim()
    .replace(/^authorization\s*:\s*/i, "")
    .replace(/[\u200B-\u200D\uFEFF]/g, "");
  const bearerMatch = trimmed.match(/^bearer\s+(.+)$/i);
  const raw = bearerMatch ? bearerMatch[1] : trimmed;
  return raw.trim().replace(/^["'`]+|["'`]+$/g, "").replace(/\s+/g, "");
}

async function authenticateMcpRequest(authHeader: string | undefined) {
  const token = extractBearerToken(authHeader);
  if (!token) {
    return { userId: null, error: { status: 401, message: "Missing Authorization header. Create a Personal MCP Token in Settings → MCP Server and send it as `Authorization: Bearer <token>`." } };
  }

  if (!token.startsWith(MCP_TOKEN_PREFIX)) {
    if (token.startsWith("mnr_")) {
      return { userId: null, error: { status: 401, message: HUB_KEY_USED_MESSAGE } };
    }
    return { userId: null, error: { status: 401, message: INVALID_TOKEN_FORMAT_MESSAGE } };
  }

  if (!MCP_TOKEN_PATTERN.test(token)) {
    console.warn("MCP token rejected due to invalid shape", {
      token_prefix: token.slice(0, 16),
      token_length: token.length,
    });
    return { userId: null, error: { status: 401, message: INVALID_TOKEN_FORMAT_MESSAGE } };
  }

  const tokenHash = await sha256Hex(token);
  const { data, error } = await supabase.rpc("lookup_mcp_token", { _token_hash: tokenHash });
  const tokenRow = Array.isArray(data) ? data[0] : null;

  if (error || !tokenRow?.user_id) {
    console.warn("MCP token rejected", {
      rpc_error: error?.message || null,
      token_prefix: token.slice(0, 16),
      token_length: token.length,
      format_ok: MCP_TOKEN_PATTERN.test(token),
    });
    return { userId: null, error: { status: 401, message: "Invalid or revoked token." } };
  }

  return { userId: tokenRow.user_id as string, error: null };
}

const ALLOWED_MOMENT_STATUSES = ["past_fact", "future_plan", "ongoing", "unknown"] as const;
const MOMENT_FIELD_NAMES = ["title", "description", "happened_at", "happened_end", "status", "impact_level", "confidence_date", "confidence_truth", "category", "person_name", "participant_names", "document_ids"] as const;
const MOMENT_RESPONSE_FIELDS = ["id", "moment_uid", "user_id", "source", "created_at", "updated_at", "person_id", ...MOMENT_FIELD_NAMES, "primary_person", "participants", "documents"] as const;

async function getEmbedding(text: string): Promise<number[]> {
  const r = await fetch(`${OPENROUTER_BASE}/embeddings`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENROUTER_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "openai/text-embedding-3-small",
      input: text,
    }),
  });
  if (!r.ok) {
    const msg = await r.text().catch(() => "");
    throw new Error(`OpenRouter embeddings failed: ${r.status} ${msg}`);
  }
  const d = await r.json();
  return d.data[0].embedding;
}

async function extractMetadata(text: string): Promise<Record<string, unknown>> {
  const r = await fetch(`${OPENROUTER_BASE}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENROUTER_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "openai/gpt-4o-mini",
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: `Extract metadata from the user's captured thought. Return JSON with:
- "people": array of people mentioned (empty if none)
- "action_items": array of implied to-dos (empty if none)
- "dates_mentioned": array of dates YYYY-MM-DD (empty if none)
- "topics": array of 1-3 short topic tags (always at least one)
- "type": one of "observation", "task", "idea", "reference", "person_note"
Only extract what's explicitly there.`,
        },
        { role: "user", content: text },
      ],
    }),
  });
  const d = await r.json();
  try {
    return JSON.parse(d.choices[0].message.content);
  } catch {
    return { topics: ["uncategorized"], type: "observation" };
  }
}

async function getMediaForNotes(noteIds: string[]): Promise<Map<string, any[]>> {
  if (!noteIds.length) return new Map();
  const { data } = await supabase
    .from("media_analysis")
    .select("note_id, storage_path, media_type, description, extracted_text, topics, page_number, original_filename")
    .in("note_id", noteIds)
    .eq("analysis_status", "complete");

  const map = new Map<string, any[]>();
  for (const item of data || []) {
    if (!map.has(item.note_id)) map.set(item.note_id, []);
    map.get(item.note_id)!.push(item);
  }
  return map;
}

function formatNote(
  t: { content: string; title?: string; metadata: Record<string, unknown>; created_at: string; id?: string },
  i: number,
  showSimilarity?: number,
  media?: any[]
): string {
  const m = t.metadata || {};
  const parts: string[] = [];
  if (showSimilarity !== undefined) {
    parts.push(`--- Result ${i + 1} (${(showSimilarity * 100).toFixed(1)}% match) ---`);
  } else {
    parts.push(`--- ${i + 1} ---`);
  }
  if (t.title) parts.push(`Title: ${t.title}`);
  if (t.id) parts.push(`ID: ${t.id}`);
  parts.push(`Captured: ${new Date(t.created_at).toLocaleDateString()}`);
  parts.push(`Type: ${m.type || "unknown"}`);
  if (Array.isArray(m.topics) && m.topics.length)
    parts.push(`Topics: ${(m.topics as string[]).join(", ")}`);
  if (Array.isArray(m.people) && m.people.length)
    parts.push(`People: ${(m.people as string[]).join(", ")}`);
  if (Array.isArray(m.action_items) && m.action_items.length)
    parts.push(`Actions: ${(m.action_items as string[]).join("; ")}`);
  parts.push(`\n${t.content}`);

  // Append media analysis info
  if (media && media.length > 0) {
    parts.push(`\nMedia (${media.length}):`);
    for (const m of media) {
      const label = m.media_type === "pdf" || m.media_type === "pdf_page"
        ? `PDF${m.page_number ? ` p.${m.page_number}` : ""}`
        : "Image";
      parts.push(`  [${label}] ${m.description || "(no description)"}`);
      if (m.topics?.length) parts.push(`    Topics: ${m.topics.join(", ")}`);
    }
  }

  return parts.join("\n");
}

function noteText(note: { title?: string | null; content?: string | null; created_at?: string | null }) {
  return `${note.title || "Untitled"}: ${String(note.content || "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").slice(0, 1000)}${note.created_at ? ` (${note.created_at})` : ""}`;
}

function clampNumber(value: unknown, min: number, max: number, fallback: number) {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.round(n)));
}

function normalizeMomentStatus(value: unknown) {
  return typeof value === "string" && ALLOWED_MOMENT_STATUSES.includes(value as any) ? value : "unknown";
}

function uniqueStrings(values: unknown[] = []) {
  return Array.from(new Set(values.filter((v): v is string => typeof v === "string" && v.trim().length > 0).map((v) => v.trim())));
}

function jsonTool(data: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function slugify(value: string) {
  return value.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "group";
}

function collectionItemUrl(collectionSlug: string, itemId: string) {
  return `https://menerio.com/collections/${collectionSlug}?item=${itemId}`;
}

function summarizeOutput(output: unknown) {
  const text = typeof output === "string" ? output : JSON.stringify(output);
  return text.length > 500 ? `${text.slice(0, 497)}...` : text;
}

async function logMcpToolCall(toolName: string, input: Record<string, unknown>, output: unknown, success: boolean) {
  await supabase.from("mcp_call_logs").insert({
    user_id: currentUserId,
    tool_name: toolName,
    input,
    output_summary: summarizeOutput(output),
    success,
  });
}

async function enforceMcpToolLimit(toolName: string, input: Record<string, unknown>) {
  const since = new Date(Date.now() - 60_000).toISOString();
  const { count, error } = await supabase
    .from("mcp_call_logs")
    .select("id", { count: "exact", head: true })
    .eq("user_id", currentUserId)
    .eq("tool_name", toolName)
    .gte("created_at", since);
  if (error) throw new Error(`Could not check MCP usage: ${error.message}`);
  if ((count || 0) >= 60) {
    const message = "Rate limit exceeded for this tool. Please wait a minute and try again.";
    await logMcpToolCall(toolName, input, message, false);
    throw new Error(message);
  }
}

async function withLoggedCollectionTool(toolName: string, input: Record<string, unknown>, handler: () => Promise<unknown>) {
  try {
    await enforceMcpToolLimit(toolName, input);
    const output = await handler();
    await logMcpToolCall(toolName, input, output, true);
    return jsonTool(output);
  } catch (err: unknown) {
    const message = (err as Error).message;
    await logMcpToolCall(toolName, input, message, false).catch(() => null);
    return { content: [{ type: "text" as const, text: `Error: ${message}` }], isError: true };
  }
}

async function collectionItemCounts(collectionIds: string[]) {
  const pairs = await Promise.all(collectionIds.map(async (id) => {
    const { count } = await supabase.from("collection_items").select("id", { count: "exact", head: true }).eq("user_id", currentUserId).eq("collection_id", id);
    return [id, count || 0] as const;
  }));
  return new Map(pairs);
}

async function getCollectionBySlug(slug: string) {
  const { data, error } = await supabase.from("collections").select("*").eq("user_id", currentUserId).eq("slug", slug).maybeSingle();
  if (error) throw new Error(`Could not load collection: ${error.message}`);
  if (!data) throw new Error(`Collection not found: ${slug}`);
  return data as any;
}

function schemaKeys(collection: any) {
  const fields = Array.isArray(collection.field_schema) ? collection.field_schema : [];
  return new Set(fields.map((field: any) => field?.key).filter((key: unknown): key is string => typeof key === "string" && key.length > 0));
}

function validateCollectionData(collection: any, data: Record<string, unknown>) {
  const allowed = schemaKeys(collection);
  const unknownKeys = Object.keys(data || {}).filter((key) => !allowed.has(key));
  if (unknownKeys.length) throw new Error(`Unknown field key(s): ${unknownKeys.join(", ")}. Call get_collection_schema first and use only keys from field_schema.`);
}

async function recentlyUsedCollectionsForDescription(limit = 8) {
  const { data: collections, error } = await supabase.from("collections").select("id, slug, name, icon, agent_instructions, updated_at").eq("user_id", currentUserId).order("updated_at", { ascending: false });
  if (error || !collections?.length) return [];
  if (collections.length <= limit) return collections as any[];

  const { data: items } = await supabase.from("collection_items").select("collection_id, updated_at").eq("user_id", currentUserId).order("updated_at", { ascending: false }).limit(200);
  const collectionById = new Map((collections as any[]).map((collection) => [collection.id, collection]));
  const ordered: any[] = [];
  const seen = new Set<string>();
  for (const item of items || []) {
    if (!seen.has((item as any).collection_id) && collectionById.has((item as any).collection_id)) {
      seen.add((item as any).collection_id);
      ordered.push(collectionById.get((item as any).collection_id));
    }
    if (ordered.length >= limit) break;
  }
  for (const collection of collections as any[]) {
    if (ordered.length >= limit) break;
    if (!seen.has(collection.id)) ordered.push(collection);
  }
  return ordered;
}

async function buildAddCollectionItemDescription() {
  const collections = await recentlyUsedCollectionsForDescription(8);
  if (!collections.length) {
    return "Add a new item to a collection. The user has defined custom collections — call list_collections first to see what's available, then get_collection_schema to know the fields. For sensitive collections (visibility=private), confirm with the user before saving.";
  }
  const guidance = collections
    .map((collection: any) => `- ${collection.icon || "📁"} ${collection.name} (slug: ${collection.slug}): ${collection.agent_instructions || "No capture instructions provided."}`)
    .join("\n");
  return `Add a new item to a collection. The user has defined the following collections — pay attention to each one's capture instructions:\n\n${guidance}\n\nCall get_collection_schema before adding to know the exact fields. For sensitive collections (visibility=private), confirm with the user before saving.`;
}

async function resolveGroup(idOrSlug: string) {
  const query = supabase.from("contact_groups").select("*").eq("user_id", currentUserId).eq("is_trashed", false);
  const { data, error } = isUuid(idOrSlug) ? await query.eq("id", idOrSlug).maybeSingle() : await query.eq("slug", idOrSlug).maybeSingle();
  if (error) throw new Error(`Could not load group: ${error.message}`);
  if (!data) throw new Error("Group not found");
  return data as any;
}

async function resolveContact(params: { contact_id?: string; contact_name?: string }) {
  if (params.contact_id) {
    const { data, error } = await supabase.from("contacts").select("*").eq("user_id", currentUserId).eq("id", params.contact_id).is("merged_into", null).maybeSingle();
    if (error) throw new Error(`Could not load person: ${error.message}`);
    if (data) return data as any;
  }
  if (params.contact_name) {
    const { data, error } = await supabase.from("contacts").select("*").eq("user_id", currentUserId).ilike("name", `%${params.contact_name}%`).is("merged_into", null).limit(1);
    if (error) throw new Error(`Could not load person: ${error.message}`);
    if (data?.[0]) return data[0] as any;
  }
  throw new Error("Person not found");
}

function buildGroupMemberSuppressionKey(groupId: string, contactId: string) {
  return ["group_member_suggestion", "contact_group", groupId, String(contactId).trim().toLowerCase()].join(":");
}

async function getSuggestionPreferences() {
  const { data } = await supabase.from("ai_suggestion_preferences").select("suggestion_mode, suggestion_sensitivity, auto_add_sensitive").eq("user_id", currentUserId).maybeSingle();
  return { mode: data?.suggestion_mode || "auto", sensitivity: data?.suggestion_sensitivity || "balanced", autoAddSensitive: data?.auto_add_sensitive === true };
}

async function filterSuppressedGroupMemberRows(rows: any[]) {
  const keys = rows.map((row) => row.suppression_key).filter(Boolean);
  if (!keys.length) return rows;
  const { data } = await supabase.from("ai_suggestion_suppressions").select("suppression_key").eq("user_id", currentUserId).in("suppression_key", keys);
  const blocked = new Set((data || []).map((row: any) => row.suppression_key));
  return rows.filter((row) => !blocked.has(row.suppression_key));
}

async function prepareGroupMemberSuggestion(row: any, preferences: { mode: string; sensitivity: string; autoAddSensitive: boolean }) {
  const thresholds: Record<string, number> = { low: 0.5, balanced: 0.7, strict: 0.85 };
  const sensitiveTerms = ["health", "medical", "diagnosis", "therapy", "politics", "religion", "financial", "salary", "private", "confidential"];
  const threshold = thresholds[preferences.sensitivity] || thresholds.balanced;
  const canAutoApply = preferences.mode === "auto" && Number(row.confidence_score || 0) >= threshold && (!row.is_sensitive || preferences.autoAddSensitive);
  if (!canAutoApply) return { ...row, status: "pending_review" };

  const { group_id, contact_id } = row.payload || {};
  if (!group_id || !contact_id) return { ...row, status: "pending_review" };
  const { data: existing } = await supabase.from("contact_group_memberships").select("id").eq("user_id", currentUserId).eq("group_id", group_id).eq("contact_id", contact_id).is("archived_at", null).maybeSingle();
  if (existing?.id) return { ...row, status: "auto_applied_unreviewed", target_entity_type: "contact_group_membership", target_entity_id: existing.id, applied_at: new Date().toISOString() };
  const { data, error } = await supabase.from("contact_group_memberships").insert({ user_id: currentUserId, group_id, contact_id, status: row.payload?.default_status || null, reason: row.description || null }).select("id").single();
  if (error || !data) return { ...row, status: "pending_review" };
  return { ...row, status: "auto_applied_unreviewed", target_entity_type: "contact_group_membership", target_entity_id: data.id, applied_at: new Date().toISOString(), is_sensitive: row.is_sensitive ?? sensitiveTerms.some((term) => String(row.description || "").toLowerCase().includes(term)) };
}

const WIKI_PAGE_TYPES = ["entity", "concept", "source", "overview", "synthesis", "person"] as const;

function extractWikiSlugs(content: string) {
  return Array.from(new Set(Array.from(content.matchAll(/\[\[([a-z0-9-]+)\]\]/g)).map((match) => match[1])));
}

async function resyncWikiLinksForCurrentUser(pageId: string, content: string) {
  const targetSlugs = extractWikiSlugs(content);
  await supabase.from("wiki_links").delete().eq("user_id", currentUserId).eq("source_page_id", pageId);

  if (!targetSlugs.length) return;

  const { data: targets, error } = await supabase
    .from("wiki_pages")
    .select("id, slug")
    .eq("user_id", currentUserId)
    .in("slug", targetSlugs);
  if (error) throw new Error(`Could not resolve wiki links: ${error.message}`);

  const targetBySlug = new Map((targets || []).map((page: any) => [page.slug, page.id]));
  const rows = targetSlugs.map((slug) => ({
    user_id: currentUserId,
    source_page_id: pageId,
    target_slug: slug,
    target_page_id: targetBySlug.get(slug) || null,
  }));

  const { error: insertError } = await supabase.from("wiki_links").insert(rows);
  if (insertError) throw new Error(`Could not insert wiki links: ${insertError.message}`);
}

async function resolveOrCreateContactsByName(names: string[]) {
  const contacts: any[] = [];
  for (const name of uniqueStrings(names)) {
    const { data: existing } = await supabase
      .from("contacts")
      .select("id, name, relationship")
      .eq("user_id", currentUserId)
      .is("merged_into", null)
      .ilike("name", name)
      .limit(1);
    if (existing?.[0]) {
      contacts.push(existing[0]);
      continue;
    }
    const { data, error } = await supabase.from("contacts").insert({ user_id: currentUserId, name }).select("id, name, relationship").single();
    if (error) throw new Error(`Could not create person '${name}': ${error.message}`);
    contacts.push(data);
  }
  return contacts;
}

// --- MCP Server Setup ---
const server = new McpServer({
  name: "open-brain",
  version: "1.0.0",
});

// Tool 1: Semantic Search
server.registerTool(
  "search_thoughts",
  {
    title: "Search Thoughts",
    description:
      "Search captured thoughts by meaning. Use this when the user asks about a topic, person, or idea they've previously captured.",
    inputSchema: {
      query: z.string().describe("What to search for"),
      limit: z.number().optional().default(10),
      threshold: z.number().optional().default(0.25),
    },
  },
  async ({ query, limit, threshold }) => {
    try {
      // Run semantic search and ILIKE text search in parallel
      let semanticResults: any[] = [];
      let semanticOk = false;

      try {
        const qEmb = await getEmbedding(query);
        const { data, error } = await supabase.rpc("match_notes", {
          query_embedding: qEmb,
          match_threshold: threshold,
          match_count: limit,
          p_user_id: currentUserId,
        });
        if (!error && data) {
          semanticResults = data;
          semanticOk = true;
        }
      } catch (_embErr) {
        console.warn("Semantic search failed, using text fallback only:", _embErr);
      }

      // ILIKE text fallback — always run to catch notes without embeddings
      const q = query.replace(/'/g, "''"); // escape single quotes
      const { data: textResults } = await supabase
        .from("notes")
        .select("id, title, content, metadata, tags, created_at")
        .eq("user_id", currentUserId)
        .eq("is_trashed", false)
        .or(`title.ilike.%${q}%,content.ilike.%${q}%`)
        .order("updated_at", { ascending: false })
        .limit(limit);

      // Merge: semantic results first, then text results (deduplicated)
      const seenIds = new Set<string>();
      const merged: any[] = [];

      for (const r of semanticResults) {
        seenIds.add(r.id);
        merged.push(r);
      }
      for (const r of (textResults || [])) {
        if (!seenIds.has(r.id)) {
          seenIds.add(r.id);
          merged.push({ ...r, similarity: null });
        }
      }

      const limited = merged.slice(0, limit);

      if (limited.length === 0) {
        return { content: [{ type: "text" as const, text: `No thoughts found matching "${query}".` }] };
      }

      // Enrich with media
      const noteIds = limited.map((t: any) => t.id);
      const mediaMap = await getMediaForNotes(noteIds);
      const results = limited.map((t: any, i: number) => formatNote(t, i, t.similarity, mediaMap.get(t.id)));

      const mode = semanticOk ? "semantic+text" : "text_only";
      return {
        content: [{ type: "text" as const, text: `Found ${limited.length} thought(s) [${mode}]:\n\n${results.join("\n\n")}` }],
      };
    } catch (err: unknown) {
      return { content: [{ type: "text" as const, text: `Error: ${(err as Error).message}` }], isError: true };
    }
  }
);

// Tool 2: List Recent
server.registerTool(
  "list_recent",
  {
    title: "List Recent Thoughts",
    description:
      "List recently captured thoughts with optional filters by type, topic, person, or time range.",
    inputSchema: {
      limit: z.number().optional().default(10),
      type: z.string().optional().describe("Filter by type: observation, task, idea, reference, person_note, meeting_note, decision, project"),
      topic: z.string().optional().describe("Filter by topic tag"),
      person: z.string().optional().describe("Filter by person mentioned"),
      days: z.number().optional().describe("Only thoughts from the last N days"),
    },
  },
  async ({ limit, type, topic, person, days }) => {
    try {
      let q = supabase
        .from("notes")
        .select("id, title, content, metadata, created_at")
        .eq("is_trashed", false)
        .eq("user_id", currentUserId)
        .order("created_at", { ascending: false })
        .limit(limit);

      if (type) q = q.contains("metadata", { type });
      if (topic) q = q.contains("metadata", { topics: [topic] });
      if (person) q = q.contains("metadata", { people: [person] });
      if (days) {
        const since = new Date();
        since.setDate(since.getDate() - days);
        q = q.gte("created_at", since.toISOString());
      }

      const { data, error } = await q;

      if (error) {
        return { content: [{ type: "text" as const, text: `Error: ${error.message}` }], isError: true };
      }

      if (!data || !data.length) {
        return { content: [{ type: "text" as const, text: "No thoughts found." }] };
      }

      // Enrich with media
      const noteIds = data.map((t: any) => t.id);
      const mediaMap = await getMediaForNotes(noteIds);
      const results = data.map((t: any, i: number) => formatNote(t, i, undefined, mediaMap.get(t.id)));

      return {
        content: [{ type: "text" as const, text: `${data.length} recent thought(s):\n\n${results.join("\n\n")}` }],
      };
    } catch (err: unknown) {
      return { content: [{ type: "text" as const, text: `Error: ${(err as Error).message}` }], isError: true };
    }
  }
);

// Tool 3: Capture Thought
server.registerTool(
  "capture_thought",
  {
    title: "Capture Thought",
    description:
      "Save a new thought to the Open Brain. Generates an embedding and extracts metadata automatically. Use this when the user wants to save something to their brain directly from any AI client.",
    inputSchema: {
      content: z.string().describe("The thought to capture"),
    },
  },
  async ({ content }) => {
    try {
      const [embedding, metadata] = await Promise.all([
        getEmbedding(content),
        extractMetadata(content),
      ]);

      const firstLine = content.split("\n")[0];
      const title = firstLine.length > 80 ? firstLine.substring(0, 77) + "..." : firstLine;

      const { error } = await supabase.from("notes").insert({
        user_id: currentUserId,
        content,
        title,
        embedding,
        metadata: { ...metadata, source: "mcp" },
        tags: Array.isArray((metadata as any).topics) ? (metadata as any).topics : [],
      });

      if (error) {
        return { content: [{ type: "text" as const, text: `Failed to capture: ${error.message}` }], isError: true };
      }

      const meta = metadata as Record<string, unknown>;
      let confirmation = `Captured as ${meta.type || "thought"}`;
      if (Array.isArray(meta.topics) && meta.topics.length)
        confirmation += ` — ${(meta.topics as string[]).join(", ")}`;
      if (Array.isArray(meta.people) && meta.people.length)
        confirmation += ` | People: ${(meta.people as string[]).join(", ")}`;
      if (Array.isArray(meta.action_items) && meta.action_items.length)
        confirmation += ` | Actions: ${(meta.action_items as string[]).join("; ")}`;

      return { content: [{ type: "text" as const, text: confirmation }] };
    } catch (err: unknown) {
      return { content: [{ type: "text" as const, text: `Error: ${(err as Error).message}` }], isError: true };
    }
  }
);

// Tool: Update Note
server.registerTool(
  "update_note",
  {
    title: "Update Note",
    description:
      "Edit an existing note's title, content (Markdown), tags, folder, favorite, or pinned state. Only fields you pass are changed. External (synced) notes cannot be edited directly — duplicate them first via the app UI.",
    inputSchema: {
      note_id: z.string().describe("The ID of the note to update"),
      title: z.string().optional(),
      content: z.string().optional().describe("Full Markdown content (replaces existing)"),
      tags: z.array(z.string()).optional(),
      folder_path: z.string().optional(),
      is_favorite: z.boolean().optional(),
      is_pinned: z.boolean().optional(),
    },
  },
  async ({ note_id, title, content, tags, folder_path, is_favorite, is_pinned }) => {
    try {
      const { data: existing, error: fetchErr } = await supabase
        .from("notes")
        .select("id, user_id, is_external")
        .eq("id", note_id)
        .maybeSingle();
      if (fetchErr) return jsonTool({ error: fetchErr.message });
      if (!existing || existing.user_id !== currentUserId) {
        return jsonTool({ error: "Note not found" });
      }
      if (existing.is_external) {
        return jsonTool({ error: "External (synced) notes cannot be edited directly. Duplicate the note in the app first." });
      }

      const updates: Record<string, unknown> = {};
      if (title !== undefined) updates.title = title;
      if (content !== undefined) updates.content = content;
      if (tags !== undefined) updates.tags = tags;
      if (folder_path !== undefined) updates.folder_path = folder_path;
      if (is_favorite !== undefined) updates.is_favorite = is_favorite;
      if (is_pinned !== undefined) updates.is_pinned = is_pinned;

      if (Object.keys(updates).length === 0) {
        return jsonTool({ error: "No fields to update" });
      }

      const { data, error } = await supabase
        .from("notes")
        .update(updates)
        .eq("id", note_id)
        .eq("user_id", currentUserId)
        .select("id, title, tags, folder_path, is_favorite, is_pinned, updated_at")
        .single();
      if (error) return jsonTool({ error: error.message });
      return jsonTool({ ok: true, note: data });
    } catch (err: unknown) {
      return jsonTool({ error: (err as Error).message });
    }
  }
);

// Tool: Trash Note (reversible)
server.registerTool(
  "trash_note",
  {
    title: "Trash Note",
    description:
      "Move a note to trash (reversible — the user can restore it from the Trash view). Use this when the user wants to delete or remove a note. Permanent deletion is intentionally NOT available to agents — only the user can hard-delete from the UI. Pass restore: true to bring a trashed note back.",
    inputSchema: {
      note_id: z.string().describe("The ID of the note to trash or restore"),
      restore: z.boolean().optional().default(false).describe("If true, restores the note from trash instead of trashing it"),
    },
  },
  async ({ note_id, restore }) => {
    try {
      const { data: existing, error: fetchErr } = await supabase
        .from("notes")
        .select("id, user_id, title")
        .eq("id", note_id)
        .maybeSingle();
      if (fetchErr) return jsonTool({ error: fetchErr.message });
      if (!existing || existing.user_id !== currentUserId) {
        return jsonTool({ error: "Note not found" });
      }

      const updates = restore
        ? { is_trashed: false, trashed_at: null }
        : { is_trashed: true, trashed_at: new Date().toISOString() };

      const { error } = await supabase
        .from("notes")
        .update(updates)
        .eq("id", note_id)
        .eq("user_id", currentUserId);
      if (error) return jsonTool({ error: error.message });

      return jsonTool({
        ok: true,
        note_id,
        title: existing.title,
        action: restore ? "restored" : "trashed",
        message: restore
          ? "Note restored from trash."
          : "Note moved to trash. The user can restore it from the Trash view.",
      });
    } catch (err: unknown) {
      return jsonTool({ error: (err as Error).message });
    }
  }
);

// Tool 4: Get Stats
server.registerTool(
  "get_stats",
  {
    title: "Brain Statistics",
    description: "Get a summary of all captured thoughts: totals, types, top topics, people, and recent activity.",
    inputSchema: {},
  },
  async () => {
    try {
      const { count } = await supabase
        .from("notes")
        .select("*", { count: "exact", head: true })
        .eq("is_trashed", false)
        .eq("user_id", currentUserId);

      const { data } = await supabase
        .from("notes")
        .select("metadata, created_at")
        .eq("is_trashed", false)
        .eq("user_id", currentUserId)
        .order("created_at", { ascending: false });

      const types: Record<string, number> = {};
      const topics: Record<string, number> = {};
      const people: Record<string, number> = {};
      let thisWeek = 0;
      const weekAgo = new Date();
      weekAgo.setDate(weekAgo.getDate() - 7);

      for (const r of data || []) {
        const m = (r.metadata || {}) as Record<string, unknown>;
        if (m.type) types[m.type as string] = (types[m.type as string] || 0) + 1;
        if (Array.isArray(m.topics))
          for (const t of m.topics) topics[t as string] = (topics[t as string] || 0) + 1;
        if (Array.isArray(m.people))
          for (const p of m.people) people[p as string] = (people[p as string] || 0) + 1;
        if (new Date(r.created_at) > weekAgo) thisWeek++;
      }

      const sort = (o: Record<string, number>): [string, number][] =>
        Object.entries(o).sort((a, b) => b[1] - a[1]).slice(0, 10);

      const lines: string[] = [
        `Total thoughts: ${count}`,
        `This week: ${thisWeek}`,
        `Date range: ${
          data?.length
            ? new Date(data[data.length - 1].created_at).toLocaleDateString() +
              " → " +
              new Date(data[0].created_at).toLocaleDateString()
            : "N/A"
        }`,
        "",
        "Types:",
        ...sort(types).map(([k, v]) => `  ${k}: ${v}`),
      ];

      if (Object.keys(topics).length) {
        lines.push("", "Top topics:");
        for (const [k, v] of sort(topics)) lines.push(`  ${k}: ${v}`);
      }

      if (Object.keys(people).length) {
        lines.push("", "People mentioned:");
        for (const [k, v] of sort(people)) lines.push(`  ${k}: ${v}`);
      }

      return { content: [{ type: "text" as const, text: lines.join("\n") }] };
    } catch (err: unknown) {
      return { content: [{ type: "text" as const, text: `Error: ${(err as Error).message}` }], isError: true };
    }
  }
);

// Tool 5: Get Action Items (from structured action_items table)
server.registerTool(
  "get_action_items",
  {
    title: "Get Action Items",
    description: "Return action items from the structured tracker. Filterable by status, priority, or person.",
    inputSchema: {
      status: z.string().optional().describe("Filter by status: open, in_progress, done, dismissed"),
      priority: z.string().optional().describe("Filter by priority: low, normal, high, urgent"),
      person: z.string().optional().describe("Filter by related contact name"),
      include_done: z.boolean().optional().default(false).describe("Include completed items"),
    },
  },
  async ({ status, priority, person, include_done }) => {
    try {
      let q = supabase
        .from("action_items")
        .select("id, content, status, priority, due_date, created_at, updated_at, source_note_id, contact_id")
        .eq("user_id", currentUserId)
        .order("created_at", { ascending: false });

      if (status) {
        q = q.eq("status", status);
      } else if (!include_done) {
        q = q.in("status", ["open", "in_progress"]);
      }
      if (priority) q = q.eq("priority", priority);

      const { data, error } = await q.limit(50);
      if (error) return { content: [{ type: "text" as const, text: `Error: ${error.message}` }], isError: true };

      let items = data || [];

      // Filter by person name if requested
      if (person && items.length > 0) {
        const contactIds = items.filter((i: any) => i.contact_id).map((i: any) => i.contact_id);
        if (contactIds.length > 0) {
          const { data: contacts } = await supabase
            .from("contacts")
            .select("id, name")
            .in("id", contactIds);
          const matchIds = new Set(
            (contacts || []).filter((c: any) => c.name.toLowerCase().includes(person.toLowerCase())).map((c: any) => c.id)
          );
          items = items.filter((i: any) => matchIds.has(i.contact_id));
        } else {
          items = [];
        }
      }

      if (!items.length) return { content: [{ type: "text" as const, text: "No action items found." }] };

      const lines = items.map((item: any, i: number) => {
        const statusIcons: Record<string, string> = { open: "⬜", in_progress: "🔄", done: "✅", dismissed: "❌" };
        const statusIcon = statusIcons[String(item.status)] || "⬜";
        const age = Math.floor((Date.now() - new Date(item.created_at).getTime()) / 86400000);
        let line = `${statusIcon} ${i + 1}. ${item.content}`;
        line += `\n   Status: ${item.status} | Priority: ${item.priority} | ${age}d old`;
        if (item.due_date) line += ` | Due: ${item.due_date}`;
        return line;
      });

      return { content: [{ type: "text" as const, text: `${items.length} action item(s):\n\n${lines.join("\n\n")}` }] };
    } catch (err: unknown) {
      return { content: [{ type: "text" as const, text: `Error: ${(err as Error).message}` }], isError: true };
    }
  }
);

// Tool 6: Get Person Notes
server.registerTool(
  "get_person_notes",
  {
    title: "Get Person Notes",
    description: "Given a person's name, return all notes mentioning them. Combines metadata filter with semantic search for comprehensive results.",
    inputSchema: {
      name: z.string().describe("The person's name to search for"),
      limit: z.number().optional().default(20),
    },
  },
  async ({ name, limit }) => {
    try {
      // Two-pronged search: metadata filter + semantic
      const [metadataResult, semanticResult] = await Promise.all([
        supabase
          .from("notes")
          .select("id, title, content, metadata, created_at")
          .eq("is_trashed", false)
          .eq("user_id", currentUserId)
          .contains("metadata", { people: [name] })
          .order("created_at", { ascending: false })
          .limit(limit),
        (async () => {
          const emb = await getEmbedding(`notes about ${name}`);
          return supabase.rpc("match_notes", {
            query_embedding: emb,
            match_threshold: 0.5,
            match_count: limit,
            p_user_id: currentUserId,
          });
        })(),
      ]);

      // Merge and deduplicate
      const seen = new Set<string>();
      const allNotes: any[] = [];

      for (const note of metadataResult.data || []) {
        if (!seen.has(note.id)) {
          seen.add(note.id);
          allNotes.push({ ...note, source: "metadata" });
        }
      }

      for (const note of semanticResult.data || []) {
        if (!seen.has(note.id)) {
          // Only include semantic results that actually mention the person
          const m = (note.metadata || {}) as Record<string, unknown>;
          const mentionsPerson =
            (Array.isArray(m.people) && (m.people as string[]).some(p => p.toLowerCase().includes(name.toLowerCase()))) ||
            note.content?.toLowerCase().includes(name.toLowerCase());
          if (mentionsPerson) {
            seen.add(note.id);
            allNotes.push({ ...note, source: "semantic" });
          }
        }
      }

      if (allNotes.length === 0) {
        return { content: [{ type: "text" as const, text: `No notes found mentioning "${name}".` }] };
      }

      const results = allNotes.slice(0, limit).map((t, i) => formatNote(t, i));

      return {
        content: [{
          type: "text" as const,
          text: `Found ${allNotes.length} note(s) mentioning "${name}":\n\n${results.join("\n\n")}`,
        }],
      };
    } catch (err: unknown) {
      return { content: [{ type: "text" as const, text: `Error: ${(err as Error).message}` }], isError: true };
    }
  }
);

// Tool 7: Search Contacts
server.registerTool(
  "search_contacts",
  {
    title: "Search Contacts",
    description: "Search your personal CRM contacts by name, company, or relationship type.",
    inputSchema: {
      query: z.string().optional().describe("Search by name or company"),
      relationship: z.string().optional().describe("Filter by relationship type"),
      limit: z.number().optional().default(10),
    },
  },
  async ({ query, relationship, limit }) => {
    try {
      let q = supabase
        .from("contacts")
        .select("id, name, relationship, company, role, email, last_contact_date, contact_frequency_days, notes")
        .eq("user_id", currentUserId)
        .order("name")
        .limit(limit);

      if (query) q = q.or(`name.ilike.%${query}%,company.ilike.%${query}%`);
      if (relationship) q = q.eq("relationship", relationship);

      const { data, error } = await q;
      if (error) return { content: [{ type: "text" as const, text: `Error: ${error.message}` }], isError: true };
      if (!data?.length) return { content: [{ type: "text" as const, text: "No contacts found." }] };

      const lines = data.map((c: any, i: number) => {
        const parts = [`${i + 1}. ${c.name}`];
        if (c.relationship) parts.push(`(${c.relationship})`);
        if (c.company) parts.push(`@ ${c.company}`);
        if (c.role) parts.push(`— ${c.role}`);
        if (c.last_contact_date) {
          const days = Math.floor((Date.now() - new Date(c.last_contact_date).getTime()) / 86400000);
          parts.push(`| Last contact: ${days}d ago`);
        }
        if (c.notes) parts.push(`\n   Notes: ${c.notes.substring(0, 200)}`);
        return parts.join(" ");
      });

      return { content: [{ type: "text" as const, text: `${data.length} contact(s):\n\n${lines.join("\n\n")}` }] };
    } catch (err: unknown) {
      return { content: [{ type: "text" as const, text: `Error: ${(err as Error).message}` }], isError: true };
    }
  }
);

// Tool 8: Get Contact Context
server.registerTool(
  "get_contact_context",
  {
    title: "Get Contact Context",
    description: "Given a contact name, return their full details, recent interactions, and related notes.",
    inputSchema: {
      name: z.string().describe("The contact's name"),
    },
  },
  async ({ name }) => {
    try {
      const { data: contacts } = await supabase
        .from("contacts")
        .select("*")
        .eq("user_id", currentUserId)
        .ilike("name", `%${name}%`)
        .limit(1);

      if (!contacts?.length) return { content: [{ type: "text" as const, text: `No contact found matching "${name}".` }] };

      const contact = contacts[0] as any;
      const lines: string[] = [
        `# ${contact.name}`,
        contact.relationship ? `Relationship: ${contact.relationship}` : "",
        contact.company ? `Company: ${contact.company}` : "",
        contact.role ? `Role: ${contact.role}` : "",
        contact.email ? `Email: ${contact.email}` : "",
        contact.phone ? `Phone: ${contact.phone}` : "",
        contact.notes ? `Notes: ${contact.notes}` : "",
      ].filter(Boolean);

      if (contact.last_contact_date) {
        const days = Math.floor((Date.now() - new Date(contact.last_contact_date).getTime()) / 86400000);
        lines.push(`Last contact: ${days} days ago (${contact.last_contact_date})`);
      }

      // Fetch interactions
      const { data: interactions } = await supabase
        .from("contact_interactions")
        .select("interaction_date, type, summary, action_items")
        .eq("contact_id", contact.id)
        .order("interaction_date", { ascending: false })
        .limit(10);

      if (interactions?.length) {
        lines.push("", "## Recent Interactions");
        for (const int of interactions as any[]) {
          lines.push(`- ${int.interaction_date} [${int.type}]: ${int.summary || "(no summary)"}`);
          if (int.action_items?.length) {
            for (const ai of int.action_items) lines.push(`  ⬜ ${ai}`);
          }
        }
      }

      // Fetch related notes
      const { data: notes } = await supabase
        .from("notes")
        .select("title, content, created_at")
        .eq("user_id", currentUserId)
        .eq("is_trashed", false)
        .contains("metadata", { people: [contact.name] })
        .order("created_at", { ascending: false })
        .limit(5);

      if (notes?.length) {
        lines.push("", "## Related Notes");
        for (const n of notes) {
          lines.push(`- [${new Date(n.created_at).toLocaleDateString()}] ${n.title}\n  ${n.content.substring(0, 150)}`);
        }
      }

      return { content: [{ type: "text" as const, text: lines.join("\n") }] };
    } catch (err: unknown) {
      return { content: [{ type: "text" as const, text: `Error: ${(err as Error).message}` }], isError: true };
    }
  }
);

server.registerTool(
  "list_people",
  {
    title: "List People",
    description: "List all people the user has recorded in Menerio.",
    inputSchema: { limit: z.number().optional().default(100) },
  },
  async ({ limit }) => {
    const { data, error } = await supabase.from("contacts").select("id, name, relationship, created_at").eq("user_id", currentUserId).is("merged_into", null).order("name").limit(limit);
    if (error) return jsonTool({ error: error.message });
    return jsonTool(data);
  }
);

server.registerTool(
  "list_moments",
  {
    title: "List Moments",
    description: "List Moments with human-equivalent fields. Optionally filter by person name.",
    inputSchema: { person_name: z.string().optional(), limit: z.number().optional().default(50) },
  },
  async ({ person_name, limit }) => {
    let q = supabase.from("moments").select("id, moment_uid, title, description, happened_at, happened_end, category, status, impact_level, confidence_date, confidence_truth, source, person_id, created_at, updated_at").eq("user_id", currentUserId).is("deleted_at", null).order("happened_at", { ascending: false }).limit(limit);
    if (person_name) {
      const { data: matches } = await supabase.from("contacts").select("id").eq("user_id", currentUserId).ilike("name", `%${person_name}%`).is("merged_into", null);
      if (!matches?.length) return jsonTool({ message: "No people matching that name." });
      q = q.in("person_id", matches.map((p: any) => p.id));
    }
    const { data, error } = await q;
    if (error) return jsonTool({ error: error.message });
    return jsonTool({ fields: MOMENT_RESPONSE_FIELDS, moments: data });
  }
);

server.registerTool(
  "search_moments",
  {
    title: "Search Moments",
    description: "Search Moments by keyword and return human-equivalent Moment fields.",
    inputSchema: { query: z.string(), limit: z.number().optional().default(20) },
  },
  async ({ query, limit }) => {
    const escaped = query.replace(/[%_]/g, "");
    const { data, error } = await supabase.from("moments").select("id, moment_uid, title, description, happened_at, happened_end, category, status, impact_level, confidence_date, confidence_truth, source, person_id, created_at, updated_at").eq("user_id", currentUserId).is("deleted_at", null).or(`title.ilike.%${escaped}%,description.ilike.%${escaped}%`).order("happened_at", { ascending: false }).limit(limit);
    if (error) return jsonTool({ error: error.message });
    return jsonTool({ fields: MOMENT_RESPONSE_FIELDS, moments: data });
  }
);

async function createMomentWithLinks(input: any, source: "mcp" | "mcp_ai") {
  const participantNames = uniqueStrings([input.person_name, ...(input.participant_names ?? [])]);
  const contacts = await resolveOrCreateContactsByName(participantNames);
  const primary = input.person_name ? contacts.find((c) => c.name.toLowerCase() === String(input.person_name).toLowerCase()) : contacts[0];
  const payload = {
    user_id: currentUserId,
    title: String(input.title || "").trim(),
    description: input.description ? String(input.description).trim() : null,
    happened_at: input.happened_at,
    happened_end: input.happened_end || null,
    status: normalizeMomentStatus(input.status),
    impact_level: clampNumber(input.impact_level, 1, 4, 2),
    confidence_date: clampNumber(input.confidence_date, 0, 10, 5),
    confidence_truth: clampNumber(input.confidence_truth, 0, 10, 5),
    category: input.category || null,
    person_id: primary?.id || null,
    source,
  };
  if (!payload.title || !payload.happened_at) throw new Error("title and happened_at are required");
  const { data: moment, error } = await supabase.from("moments").insert(payload).select("*").single();
  if (error) throw new Error(error.message);
  const participantIds = Array.from(new Set(contacts.map((c) => c.id)));
  if (participantIds.length) {
    const { error: participantError } = await supabase.from("moment_participants").insert(participantIds.map((person_id) => ({ moment_id: moment.id, person_id })));
    if (participantError) throw new Error(participantError.message);
  }
  return { ...moment, primary_person: primary || null, participants: contacts, documents: [], field_parity: { available_moment_fields: MOMENT_FIELD_NAMES, response_fields: MOMENT_RESPONSE_FIELDS } };
}

const rawMomentSchema = {
  title: z.string().describe("Moment title/headline"),
  description: z.string().optional().describe("Moment description"),
  happened_at: z.string().describe("Start date/time, ISO 8601 or YYYY-MM-DD"),
  happened_end: z.string().optional().describe("Optional end date/time, ISO 8601 or YYYY-MM-DD"),
  status: z.enum(ALLOWED_MOMENT_STATUSES).optional().default("unknown").describe("past_fact/future_plan/ongoing/unknown"),
  impact_level: z.number().optional().default(2).describe("1-4 structural life impact"),
  confidence_date: z.number().optional().default(5).describe("0-10 certainty of the date"),
  confidence_truth: z.number().optional().default(5).describe("0-10 certainty that the moment is accurate"),
  category: z.string().optional().describe("Optional category label"),
  person_name: z.string().optional().describe("Primary person to link or create"),
  participant_names: z.array(z.string()).optional().describe("Additional people to link or create"),
  document_ids: z.array(z.string()).optional().describe("Reserved for provenance links when documents are available"),
};

async function draftMomentFromDescription(description: string, params: any) {
  const { data: contacts } = await supabase.from("contacts").select("name").eq("user_id", currentUserId).is("merged_into", null).order("name");
  const peopleContext = contacts?.length ? `\n\nKnown people in the user's timeline: ${contacts.map((p: any) => p.name).join(", ")}` : "";
  const hints = [params.happened_at && `Date hint: ${params.happened_at}`, params.title_hint && `Title hint: ${params.title_hint}`, params.category_hint && `Category hint: ${params.category_hint}`, params.status_hint && `Status hint: ${params.status_hint}`, params.person_name && `Primary person hint: ${params.person_name}`, params.participant_names?.length && `Participant hints: ${params.participant_names.join(", ")}`].filter(Boolean).join("\n");
  const content = hints ? `${description}\n\nUse these caller-provided hints where appropriate:\n${hints}` : description;
  const { result, credits } = await openRouterWithCredits(supabase, OPENROUTER_API_KEY, currentUserId, "mcp-create-moment", "chat/completions", {
    model: "google/gemini-3-flash-preview",
    messages: [{ role: "system", content: `Extract a structured Menerio timeline Moment. Return only via the draft_moment tool. Today's date: ${new Date().toISOString().slice(0, 10)}${peopleContext}` }, { role: "user", content }],
    tools: [{ type: "function", function: { name: "draft_moment", description: "Return a structured timeline moment draft.", parameters: { type: "object", properties: { happened_at: { type: "string" }, happened_end: { type: "string" }, title: { type: "string" }, status: { type: "string", enum: ALLOWED_MOMENT_STATUSES }, impact_level: { type: "integer", minimum: 1, maximum: 4 }, confidence_date: { type: "integer", minimum: 0, maximum: 10 }, confidence_truth: { type: "integer", minimum: 0, maximum: 10 }, participants: { type: "array", items: { type: "string" } } }, required: ["happened_at", "title", "status", "impact_level", "confidence_date", "confidence_truth"], additionalProperties: false } } }],
    tool_choice: { type: "function", function: { name: "draft_moment" } },
  });
  const toolCall = result.choices?.[0]?.message?.tool_calls?.[0];
  if (!toolCall) throw new Error("AI draft did not produce a moment");
  return { draft: JSON.parse(toolCall.function.arguments), credits };
}

server.registerTool("create_moment_with_ai", { title: "Create Moment with AI", description: "Preferred default. Create a Moment from a natural-language description; AI fills in the structured fields and saves it automatically.", inputSchema: { description: z.string(), happened_at: z.string().optional(), person_name: z.string().optional(), participant_names: z.array(z.string()).optional(), title_hint: z.string().optional(), category_hint: z.string().optional(), status_hint: z.enum(ALLOWED_MOMENT_STATUSES).optional(), impact_level_hint: z.number().optional(), confidence_date_hint: z.number().optional(), confidence_truth_hint: z.number().optional(), document_ids: z.array(z.string()).optional() } }, async (params) => {
  try {
    const { draft, credits } = await draftMomentFromDescription(params.description, params);
    const names = uniqueStrings([params.person_name, ...(params.participant_names ?? []), ...(draft.participants ?? [])]);
    const moment = await createMomentWithLinks({ ...draft, description: params.description, title: params.title_hint ?? draft.title, happened_at: params.happened_at ?? draft.happened_at, category: params.category_hint ?? draft.category, status: params.status_hint ?? draft.status, impact_level: params.impact_level_hint ?? draft.impact_level, confidence_date: params.confidence_date_hint ?? draft.confidence_date, confidence_truth: params.confidence_truth_hint ?? draft.confidence_truth, person_name: params.person_name ?? names[0], participant_names: names, document_ids: params.document_ids ?? [] }, "mcp_ai");
    return jsonTool({ tool: "create_moment_with_ai", approval_required: false, ai_enrichment_used: "draft-event", credits, moment });
  } catch (err: unknown) { return jsonTool({ error: err instanceof Error ? err.message : "Unknown error" }); }
});

server.registerTool("create_moment_raw", { title: "Create Moment Raw", description: "Low-level exact structured Moment creation for imports, migrations, replay, tests, or fully specified machine-written data. Do not use this for normal conversational capture. Prefer create_moment_with_ai when the user describes what happened in natural language.", inputSchema: rawMomentSchema }, async (params) => {
  try { return jsonTool({ tool: "create_moment_raw", moment: await createMomentWithLinks(params, "mcp") }); } catch (err: unknown) { return jsonTool({ error: err instanceof Error ? err.message : "Unknown error", preferred_tool: "create_moment_with_ai" }); }
});

server.registerTool("create_moment", { title: "Create Moment", description: "Deprecated compatibility alias for create_moment_raw. Low-level exact structured writes only; do not use for conversational capture. Prefer create_moment_with_ai for normal user-described Moments.", inputSchema: rawMomentSchema }, async (params) => {
  try { return jsonTool({ tool: "create_moment (deprecated raw alias)", note: "create_moment is a deprecated compatibility alias. Prefer create_moment_with_ai for conversational capture.", moment: await createMomentWithLinks(params, "mcp") }); } catch (err: unknown) { return jsonTool({ error: err instanceof Error ? err.message : "Unknown error" }); }
});

// Tool 10: Get Connected Notes (Graph)
server.registerTool(
  "get_connected_notes",
  {
    title: "Get Connected Notes",
    description: "Given a note title or ID, return all connected notes with connection types and strengths from the knowledge graph.",
    inputSchema: {
      note: z.string().describe("Note title or ID to look up"),
      limit: z.number().optional().default(20),
    },
  },
  async ({ note, limit }) => {
    try {
      // Find the note by title or ID
      let noteId = note;
      const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(note);
      if (!isUuid) {
        const { data } = await supabase
          .from("notes")
          .select("id")
          .eq("user_id", currentUserId)
          .ilike("title", `%${note}%`)
          .limit(1);
        if (!data?.length) return { content: [{ type: "text" as const, text: `No note found matching "${note}".` }] };
        noteId = data[0].id;
      }

      const { data: connections } = await supabase
        .from("note_connections")
        .select("*")
        .eq("user_id", currentUserId)
        .or(`source_note_id.eq.${noteId},target_note_id.eq.${noteId}`)
        .order("strength", { ascending: false })
        .limit(limit);

      if (!connections?.length) return { content: [{ type: "text" as const, text: "No connections found for this note." }] };

      // Get linked note details
      const linkedIds = [...new Set(connections.map((c: any) =>
        c.source_note_id === noteId ? c.target_note_id : c.source_note_id
      ))];
      const { data: linkedNotes } = await supabase
        .from("notes")
        .select("id, title, metadata")
        .in("id", linkedIds);

      const noteMap = new Map((linkedNotes || []).map((n: any) => [n.id, n]));

      const lines = connections.map((c: any, i: number) => {
        const linkedId = c.source_note_id === noteId ? c.target_note_id : c.source_note_id;
        const linked = noteMap.get(linkedId);
        const dir = c.source_note_id === noteId ? "→" : "←";
        return `${i + 1}. ${dir} ${linked?.title || "Unknown"} [${c.connection_type}] strength: ${c.strength}`;
      });

      return { content: [{ type: "text" as const, text: `${connections.length} connection(s):\n\n${lines.join("\n")}` }] };
    } catch (err: unknown) {
      return { content: [{ type: "text" as const, text: `Error: ${(err as Error).message}` }], isError: true };
    }
  }
);

// Tool 11: Find Path Between Notes
server.registerTool(
  "find_path",
  {
    title: "Find Path Between Notes",
    description: "Given two note titles, find the shortest path between them through the knowledge graph.",
    inputSchema: {
      from_note: z.string().describe("Title or ID of the starting note"),
      to_note: z.string().describe("Title or ID of the destination note"),
    },
  },
  async ({ from_note, to_note }) => {
    try {
      // Resolve IDs
      async function resolveId(query: string): Promise<string | null> {
        const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(query);
        if (isUuid) return query;
        const { data } = await supabase
          .from("notes")
          .select("id")
          .eq("user_id", currentUserId)
          .ilike("title", `%${query}%`)
          .limit(1);
        return data?.[0]?.id || null;
      }

      const [fromId, toId] = await Promise.all([resolveId(from_note), resolveId(to_note)]);
      if (!fromId) return { content: [{ type: "text" as const, text: `Note not found: "${from_note}"` }] };
      if (!toId) return { content: [{ type: "text" as const, text: `Note not found: "${to_note}"` }] };

      // Fetch all connections for BFS
      const { data: allConns } = await supabase
        .from("note_connections")
        .select("source_note_id, target_note_id, connection_type, strength")
        .eq("user_id", currentUserId);

      if (!allConns?.length) return { content: [{ type: "text" as const, text: "No connections in graph." }] };

      // Build adjacency
      const adj = new Map<string, { id: string; type: string }[]>();
      for (const c of allConns) {
        if (!adj.has(c.source_note_id)) adj.set(c.source_note_id, []);
        if (!adj.has(c.target_note_id)) adj.set(c.target_note_id, []);
        adj.get(c.source_note_id)!.push({ id: c.target_note_id, type: c.connection_type });
        adj.get(c.target_note_id)!.push({ id: c.source_note_id, type: c.connection_type });
      }

      // BFS
      const visited = new Set<string>();
      const parent = new Map<string, { id: string; type: string }>();
      const queue = [fromId];
      visited.add(fromId);
      let found = false;

      while (queue.length > 0 && !found) {
        const current = queue.shift()!;
        for (const neighbor of adj.get(current) || []) {
          if (!visited.has(neighbor.id)) {
            visited.add(neighbor.id);
            parent.set(neighbor.id, { id: current, type: neighbor.type });
            if (neighbor.id === toId) { found = true; break; }
            queue.push(neighbor.id);
          }
        }
      }

      if (!found) return { content: [{ type: "text" as const, text: "No path found between these notes." }] };

      // Reconstruct path
      const path: string[] = [toId];
      const edgeTypes: string[] = [];
      let cur = toId;
      while (cur !== fromId) {
        const p = parent.get(cur)!;
        edgeTypes.unshift(p.type);
        path.unshift(p.id);
        cur = p.id;
      }

      // Get note titles
      const { data: pathNotes } = await supabase
        .from("notes")
        .select("id, title")
        .in("id", path);
      const titleMap = new Map((pathNotes || []).map((n: any) => [n.id, n.title]));

      const pathStr = path.map((id, i) => {
        const title = titleMap.get(id) || "Unknown";
        return i < path.length - 1
          ? `${title} --[${edgeTypes[i]}]-->`
          : title;
      }).join(" ");

      return { content: [{ type: "text" as const, text: `Path (${path.length} notes, ${path.length - 1} hops):\n\n${pathStr}` }] };
    } catch (err: unknown) {
      return { content: [{ type: "text" as const, text: `Error: ${(err as Error).message}` }], isError: true };
    }
  }
);

// Tool 12: Get Topic Clusters
server.registerTool(
  "get_clusters",
  {
    title: "Get Topic Clusters",
    description: "Return topic clusters in the knowledge graph — groups of tightly connected notes.",
    inputSchema: {
      min_size: z.number().optional().default(2).describe("Minimum cluster size"),
    },
  },
  async ({ min_size }) => {
    try {
      // Fetch all connections
      const { data: allConns } = await supabase
        .from("note_connections")
        .select("source_note_id, target_note_id")
        .eq("user_id", currentUserId);

      if (!allConns?.length) return { content: [{ type: "text" as const, text: "No connections in graph." }] };

      // Get all note IDs involved
      const allIds = new Set<string>();
      const adj = new Map<string, string[]>();
      for (const c of allConns) {
        allIds.add(c.source_note_id);
        allIds.add(c.target_note_id);
        if (!adj.has(c.source_note_id)) adj.set(c.source_note_id, []);
        if (!adj.has(c.target_note_id)) adj.set(c.target_note_id, []);
        adj.get(c.source_note_id)!.push(c.target_note_id);
        adj.get(c.target_note_id)!.push(c.source_note_id);
      }

      // Label propagation
      const labels = new Map<string, string>();
      for (const id of allIds) labels.set(id, id);

      for (let iter = 0; iter < 10; iter++) {
        let changed = false;
        for (const id of allIds) {
          const neighbors = adj.get(id) || [];
          if (neighbors.length === 0) continue;
          const freq = new Map<string, number>();
          for (const nb of neighbors) {
            const l = labels.get(nb)!;
            freq.set(l, (freq.get(l) || 0) + 1);
          }
          let maxLabel = labels.get(id)!;
          let maxCount = 0;
          for (const [l, c] of freq) {
            if (c > maxCount) { maxCount = c; maxLabel = l; }
          }
          if (maxLabel !== labels.get(id)) {
            labels.set(id, maxLabel);
            changed = true;
          }
        }
        if (!changed) break;
      }

      // Group
      const clusters = new Map<string, string[]>();
      for (const [id, label] of labels) {
        if (!clusters.has(label)) clusters.set(label, []);
        clusters.get(label)!.push(id);
      }

      const validClusters = [...clusters.values()].filter((c) => c.length >= min_size).sort((a, b) => b.length - a.length);

      if (validClusters.length === 0) return { content: [{ type: "text" as const, text: "No clusters found." }] };

      // Get titles for all notes in clusters
      const allClusterIds = validClusters.flat();
      const { data: notes } = await supabase
        .from("notes")
        .select("id, title, metadata")
        .in("id", allClusterIds);
      const noteMap = new Map((notes || []).map((n: any) => [n.id, n]));

      const lines = validClusters.map((ids, i) => {
        const clusterNotes = ids.map((id) => noteMap.get(id)).filter(Boolean);
        const topics = new Map<string, number>();
        for (const n of clusterNotes) {
          const m = (n.metadata || {}) as Record<string, unknown>;
          for (const t of (Array.isArray(m.topics) ? m.topics : []) as string[]) {
            topics.set(t, (topics.get(t) || 0) + 1);
          }
        }
        const topTopics = [...topics.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([t]) => t);
        const label = topTopics.length > 0 ? topTopics.join(" & ") : `Cluster ${i + 1}`;
        const noteList = clusterNotes.slice(0, 5).map((n: any) => `  - ${n.title}`).join("\n");
        const more = ids.length > 5 ? `\n  ... and ${ids.length - 5} more` : "";
        return `${i + 1}. ${label} (${ids.length} notes)\n${noteList}${more}`;
      });

      return { content: [{ type: "text" as const, text: `${validClusters.length} cluster(s):\n\n${lines.join("\n\n")}` }] };
    } catch (err: unknown) {
      return { content: [{ type: "text" as const, text: `Error: ${(err as Error).message}` }], isError: true };
    }
  }
);

// Tool 9: Log Interaction
server.registerTool(
  "log_interaction",
  {
    title: "Log Interaction",
    description: "Record a new interaction with a contact. Also updates the contact's last_contact_date.",
    inputSchema: {
      contact_name: z.string().describe("The contact's name"),
      type: z.string().describe("Interaction type: meeting, call, email, message, social"),
      summary: z.string().optional().describe("Brief summary of the interaction"),
      action_items: z.array(z.string()).optional().describe("Action items from this interaction"),
      group_id_or_slug: z.string().optional().describe("Optional group id or slug to log this interaction against a Group"),
    },
  },
  async ({ contact_name, type, summary, action_items, group_id_or_slug }) => {
    try {
      const { data: contacts } = await supabase
        .from("contacts")
        .select("id, name")
        .eq("user_id", currentUserId)
        .ilike("name", `%${contact_name}%`)
        .limit(1);

      if (!contacts?.length) {
        return { content: [{ type: "text" as const, text: `No contact found matching "${contact_name}". Create the contact first.` }] };
      }

      const contact = contacts[0] as any;
      const today = new Date().toISOString().split("T")[0];
      const group = group_id_or_slug ? await resolveGroup(group_id_or_slug) : null;

      const { error: intError } = await supabase.from("contact_interactions").insert({
        contact_id: contact.id,
        user_id: currentUserId,
        type,
        summary: summary || null,
        action_items: action_items || [],
        interaction_date: today,
        group_id: group?.id || null,
      });

      if (intError) {
        return { content: [{ type: "text" as const, text: `Failed to log: ${intError.message}` }], isError: true };
      }

      await supabase.from("contacts").update({ last_contact_date: today }).eq("id", contact.id);

      let msg = `Logged ${type} with ${contact.name}${group ? ` in ${group.name}` : ""}`;
      if (action_items?.length) msg += ` | ${action_items.length} action item(s)`;
      return { content: [{ type: "text" as const, text: msg }] };
    } catch (err: unknown) {
      return { content: [{ type: "text" as const, text: `Error: ${(err as Error).message}` }], isError: true };
    }
  }
);

// Tool 13: Search Images
server.registerTool(
  "search_images",
  {
    title: "Search Images & PDFs",
    description:
      "Search across all analyzed images and PDFs by description or extracted text. Returns matching media with descriptions, extracted text, and the parent note context. Use this to find visual content like diagrams, screenshots, whiteboards, or any image/PDF that was previously captured.",
    inputSchema: {
      query: z.string().describe("What to search for in images/PDFs"),
      limit: z.number().optional().default(10),
      threshold: z.number().optional().default(0.5),
    },
  },
  async ({ query, limit, threshold }) => {
    try {
      const qEmb = await getEmbedding(query);
      const { data, error } = await supabase.rpc("match_media", {
        query_embedding: qEmb,
        match_threshold: threshold,
        match_count: limit,
        p_user_id: currentUserId,
      });

      if (error) {
        return { content: [{ type: "text" as const, text: `Search error: ${error.message}` }], isError: true };
      }

      if (!data || data.length === 0) {
        return { content: [{ type: "text" as const, text: `No images or PDFs found matching "${query}".` }] };
      }

      const results = data.map((m: any, i: number) => {
        const parts: string[] = [];
        parts.push(`--- Result ${i + 1} (${(m.similarity * 100).toFixed(1)}% match) ---`);
        const label = m.media_type === "pdf" || m.media_type === "pdf_page"
          ? `PDF${m.page_number ? ` page ${m.page_number}` : ""}`
          : "Image";
        parts.push(`Type: ${label}`);
        if (m.original_filename) parts.push(`File: ${m.original_filename}`);
        parts.push(`Note: ${m.note_title}`);
        if (m.description) parts.push(`Description: ${m.description}`);
        if (m.topics?.length) parts.push(`Topics: ${m.topics.join(", ")}`);
        if (m.extracted_text) parts.push(`Extracted text:\n${m.extracted_text.substring(0, 500)}`);
        return parts.join("\n");
      });

      return {
        content: [{ type: "text" as const, text: `Found ${data.length} media match(es):\n\n${results.join("\n\n")}` }],
      };
    } catch (err: unknown) {
      return { content: [{ type: "text" as const, text: `Error: ${(err as Error).message}` }], isError: true };
    }
  }
);

// Tool 14: Get Note Media
server.registerTool(
  "get_note_media",
  {
    title: "Get Note Media",
    description:
      "Given a note title or ID, return all analyzed images and PDFs in that note with their descriptions, extracted text, and topics.",
    inputSchema: {
      note: z.string().describe("Note title or ID"),
    },
  },
  async ({ note }) => {
    try {
      // Resolve note ID
      let noteId = note;
      const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(note);
      if (!isUuid) {
        const { data } = await supabase
          .from("notes")
          .select("id")
          .eq("user_id", currentUserId)
          .ilike("title", `%${note}%`)
          .limit(1);
        if (!data?.length) return { content: [{ type: "text" as const, text: `No note found matching "${note}".` }] };
        noteId = data[0].id;
      }

      const { data: media, error } = await supabase
        .from("media_analysis")
        .select("storage_path, media_type, page_number, original_filename, description, extracted_text, topics, analysis_status, raw_analysis")
        .eq("note_id", noteId)
        .eq("user_id", currentUserId)
        .order("created_at", { ascending: true });

      if (error) return { content: [{ type: "text" as const, text: `Error: ${error.message}` }], isError: true };
      if (!media?.length) return { content: [{ type: "text" as const, text: "No media found in this note." }] };

      const lines = media.map((m: any, i: number) => {
        const parts: string[] = [];
        const label = m.media_type === "pdf" || m.media_type === "pdf_page"
          ? `PDF${m.page_number ? ` page ${m.page_number}` : ""}`
          : "Image";
        parts.push(`${i + 1}. [${label}] ${m.original_filename || m.storage_path.split("/").pop()}`);
        parts.push(`   Status: ${m.analysis_status}`);
        if (m.description) parts.push(`   Description: ${m.description}`);
        if (m.topics?.length) parts.push(`   Topics: ${m.topics.join(", ")}`);
        if (m.extracted_text) parts.push(`   Text: ${m.extracted_text.substring(0, 300)}${m.extracted_text.length > 300 ? "…" : ""}`);
        const raw = m.raw_analysis as Record<string, unknown> | null;
        if (raw?.content_type) parts.push(`   Content type: ${raw.content_type}`);
        return parts.join("\n");
      });

      return {
        content: [{ type: "text" as const, text: `${media.length} media item(s) in this note:\n\n${lines.join("\n\n")}` }],
      };
    } catch (err: unknown) {
      return { content: [{ type: "text" as const, text: `Error: ${(err as Error).message}` }], isError: true };
    }
  }
);

// Tool: Get User Profile
server.registerTool(
  "get_user_profile",
  {
    title: "Get User Profile",
    description:
      "Retrieve the user's personal profile — identity, preferences, values, goals, health info, and explicit instructions for how to interact with them. Use this at the start of conversations to understand who you're working with, or when you need specific context about the user's preferences, background, or communication style. Supports scope filtering so you only get the categories relevant to your role.",
    inputSchema: {
      scope: z.string().optional().describe("Filter by scope: all, professional, personal, health. Omit to get everything except private."),
      categories: z.array(z.string()).optional().describe("Only return these category slugs"),
      include_notes: z.boolean().optional().default(false).describe("Include linked note content"),
      include_instructions: z.boolean().optional().default(true).describe("Include agent instructions"),
    },
  },
  async ({ scope, categories: catSlugs, include_notes, include_instructions }) => {
    try {
      // Fetch categories (never return private via MCP)
      let catQuery = supabase
        .from("profile_categories")
        .select("id, name, slug, visibility_scope, sort_order")
        .eq("user_id", currentUserId)
        .neq("visibility_scope", "private")
        .order("sort_order");

      if (scope) {
        catQuery = catQuery.in("visibility_scope", ["all", scope]);
      }

      const { data: cats, error: catErr } = await catQuery;
      if (catErr) return { content: [{ type: "text" as const, text: `Error: ${catErr.message}` }], isError: true };

      let filteredCats = cats || [];
      if (catSlugs?.length) {
        filteredCats = filteredCats.filter((c: any) => catSlugs.includes(c.slug));
      }

      // Fetch entries for these categories
      const catIds = filteredCats.map((c: any) => c.id);
      if (catIds.length === 0) {
        return {
          content: [{
            type: "text" as const,
            text: "No profile has been set up yet. The user can create their profile in Menerio's Profile section.",
          }],
        };
      }

      const { data: entries } = await supabase
        .from("profile_entries")
        .select("category_id, label, value, linked_note_id, sort_order")
        .eq("user_id", currentUserId)
        .in("category_id", catIds)
        .order("sort_order");

      // Check if there are any entries at all
      if (!entries?.length) {
        return {
          content: [{
            type: "text" as const,
            text: "No profile has been set up yet. The user can create their profile in Menerio's Profile section.",
          }],
        };
      }

      // Optionally fetch linked notes
      const noteMap = new Map<string, { title: string; content: string }>();
      if (include_notes) {
        const noteIds = entries.filter((e: any) => e.linked_note_id).map((e: any) => e.linked_note_id);
        if (noteIds.length > 0) {
          const { data: notes } = await supabase
            .from("notes")
            .select("id, title, content")
            .in("id", [...new Set(noteIds)]);
          for (const n of notes || []) {
            noteMap.set(n.id, { title: n.title, content: n.content });
          }
        }
      }

      // Build structured response
      const profileCategories = filteredCats.map((cat: any) => {
        const catEntries = (entries || [])
          .filter((e: any) => e.category_id === cat.id)
          .map((e: any) => {
            const entry: Record<string, unknown> = {
              label: e.label,
              value: e.value,
              has_linked_note: !!e.linked_note_id,
            };
            if (e.linked_note_id && noteMap.has(e.linked_note_id)) {
              entry.linked_note_title = noteMap.get(e.linked_note_id)!.title;
              if (include_notes) {
                entry.linked_note_content = noteMap.get(e.linked_note_id)!.content;
              }
            }
            return entry;
          });

        if (catEntries.length === 0) return null;
        return { name: cat.name, slug: cat.slug, entries: catEntries };
      }).filter(Boolean);

      if (profileCategories.length === 0) {
        return {
          content: [{
            type: "text" as const,
            text: "No profile has been set up yet. The user can create their profile in Menerio's Profile section.",
          }],
        };
      }

      const result: Record<string, unknown> = {
        profile: { categories: profileCategories },
      };

      // Agent instructions
      if (include_instructions) {
        const instQuery = supabase
          .from("agent_instructions")
          .select("instruction, applies_to")
          .eq("user_id", currentUserId)
          .eq("is_active", true)
          .order("sort_order");

        const { data: insts } = await instQuery;
        const filtered = (insts || []).filter((i: any) => {
          if (scope) return i.applies_to === "all" || i.applies_to === scope;
          return i.applies_to !== "private";
        });

        if (filtered.length > 0) {
          (result.profile as any).agent_instructions = filtered.map((i: any) => i.instruction);
        }
      }

      return {
        content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
      };
    } catch (err: unknown) {
      return { content: [{ type: "text" as const, text: `Error: ${(err as Error).message}` }], isError: true };
    }
  }
);

server.registerTool(
  "lexicon_search",
  {
    title: "Search Lexicon",
    description: "Search Lexicon pages by title, slug, or content. Returns matching pages with summaries.",
    inputSchema: {
      query: z.string().describe("Case-insensitive substring to search for"),
      limit: z.number().optional().default(10),
      page_type: z.enum(WIKI_PAGE_TYPES).optional().describe("Optional Lexicon page type filter"),
    },
  },
  async ({ query, limit, page_type }) => {
    try {
      const safeLimit = clampNumber(limit, 1, 50, 10);
      const q = String(query || "").trim().replace(/[%_]/g, "\\$&");
      let request = supabase
        .from("wiki_pages")
        .select("slug, title, page_type, summary, source_count, updated_at")
        .eq("user_id", currentUserId)
        .or(`title.ilike.%${q}%,slug.ilike.%${q}%,content.ilike.%${q}%`)
        .order("updated_at", { ascending: false })
        .limit(safeLimit);

      if (page_type) request = request.eq("page_type", page_type);
      const { data, error } = await request;
      if (error) return { content: [{ type: "text" as const, text: `Error: ${error.message}` }], isError: true };
      return jsonTool({ pages: data || [] });
    } catch (err: unknown) {
      return { content: [{ type: "text" as const, text: `Error: ${(err as Error).message}` }], isError: true };
    }
  }
);

server.registerTool(
  "lexicon_get_page",
  {
    title: "Get Lexicon Page",
    description: "Get a Lexicon page by slug, including full content, source notes, and backlinks.",
    inputSchema: { slug: z.string().describe("Lexicon page slug") },
  },
  async ({ slug }) => {
    try {
      const { data: page, error } = await supabase
        .from("wiki_pages")
        .select("id, slug, title, page_type, summary, content, source_count, created_at, updated_at")
        .eq("user_id", currentUserId)
        .eq("slug", slug)
        .maybeSingle();
      if (error) return { content: [{ type: "text" as const, text: `Error: ${error.message}` }], isError: true };
      if (!page) return { content: [{ type: "text" as const, text: `No Lexicon page found for slug '${slug}'.` }] };

      const { data: sourceRows } = await supabase
        .from("wiki_page_sources")
        .select("note_id")
        .eq("user_id", currentUserId)
        .eq("wiki_page_id", page.id);
      const noteIds = (sourceRows || []).map((row: any) => row.note_id).filter(Boolean);
      const { data: sourceNotes } = noteIds.length
        ? await supabase.from("notes").select("id, title, created_at, updated_at").eq("user_id", currentUserId).in("id", noteIds)
        : { data: [] };

      const { data: backlinks } = await supabase
        .from("wiki_links")
        .select("source_page_id")
        .eq("user_id", currentUserId)
        .eq("target_page_id", page.id);
      const backlinkIds = [...new Set((backlinks || []).map((link: any) => link.source_page_id).filter(Boolean))];
      const { data: backlinkPages } = backlinkIds.length
        ? await supabase.from("wiki_pages").select("slug, title, page_type, summary").eq("user_id", currentUserId).in("id", backlinkIds)
        : { data: [] };

      return jsonTool({ ...page, source_notes: sourceNotes || [], backlinks: backlinkPages || [] });
    } catch (err: unknown) {
      return { content: [{ type: "text" as const, text: `Error: ${(err as Error).message}` }], isError: true };
    }
  }
);

server.registerTool(
  "lexicon_create_page",
  {
    title: "Create Lexicon Page",
    description: "Create a Lexicon page on the user's behalf and record a reviewed manual revision.",
    inputSchema: {
      slug: z.string().regex(/^[a-z0-9-]+$/).describe("Stable lowercase kebab-case slug"),
      title: z.string().describe("Page title"),
      page_type: z.enum(WIKI_PAGE_TYPES).describe("Lexicon page type"),
      content: z.string().describe("Full markdown content"),
      summary: z.string().optional().describe("Short summary"),
    },
  },
  async ({ slug, title, page_type, content, summary }) => {
    try {
      const { data: page, error } = await supabase
        .from("wiki_pages")
        .insert({ user_id: currentUserId, slug, title, page_type, content, summary: summary || null })
        .select("id, slug, title, page_type, summary, content, created_at, updated_at")
        .single();
      if (error) return { content: [{ type: "text" as const, text: `Error: ${error.message}` }], isError: true };

      const { error: revisionError } = await supabase.from("wiki_revisions").insert({
        user_id: currentUserId,
        wiki_page_id: page.id,
        page_slug: slug,
        page_title: title,
        change_type: "manual_edit",
        previous_content: null,
        new_content: content,
        source_note_id: null,
        change_summary: "Created via MCP",
        status: "reviewed",
        reviewed_at: new Date().toISOString(),
      });
      if (revisionError) throw new Error(`Page created, but revision failed: ${revisionError.message}`);
      await resyncWikiLinksForCurrentUser(page.id, content);
      return jsonTool({ ok: true, page });
    } catch (err: unknown) {
      return { content: [{ type: "text" as const, text: `Error: ${(err as Error).message}` }], isError: true };
    }
  }
);

server.registerTool(
  "lexicon_update_page",
  {
    title: "Update Lexicon Page",
    description: "Update a Lexicon page on the user's behalf and record a reviewed manual revision.",
    inputSchema: {
      slug: z.string().describe("Existing Lexicon page slug"),
      content: z.string().optional().describe("Replacement markdown content"),
      title: z.string().optional().describe("New title"),
      summary: z.string().optional().describe("New summary"),
      page_type: z.enum(WIKI_PAGE_TYPES).optional().describe("New page type"),
    },
  },
  async ({ slug, content, title, summary, page_type }) => {
    try {
      const { data: existing, error: fetchError } = await supabase
        .from("wiki_pages")
        .select("id, slug, title, page_type, summary, content")
        .eq("user_id", currentUserId)
        .eq("slug", slug)
        .maybeSingle();
      if (fetchError) return { content: [{ type: "text" as const, text: `Error: ${fetchError.message}` }], isError: true };
      if (!existing) return { content: [{ type: "text" as const, text: `No Lexicon page found for slug '${slug}'.` }] };

      const updates: Record<string, unknown> = {};
      if (content !== undefined) updates.content = content;
      if (title !== undefined) updates.title = title;
      if (summary !== undefined) updates.summary = summary;
      if (page_type !== undefined) updates.page_type = page_type;
      if (Object.keys(updates).length === 0) return jsonTool({ ok: true, changed: false, page: existing });

      const { data: updated, error: updateError } = await supabase
        .from("wiki_pages")
        .update(updates)
        .eq("user_id", currentUserId)
        .eq("id", existing.id)
        .select("id, slug, title, page_type, summary, content, updated_at")
        .single();
      if (updateError) return { content: [{ type: "text" as const, text: `Error: ${updateError.message}` }], isError: true };

      const { error: revisionError } = await supabase.from("wiki_revisions").insert({
        user_id: currentUserId,
        wiki_page_id: existing.id,
        page_slug: updated.slug,
        page_title: updated.title,
        change_type: "manual_edit",
        previous_content: existing.content,
        new_content: updated.content,
        source_note_id: null,
        change_summary: "Updated via MCP",
        status: "reviewed",
        reviewed_at: new Date().toISOString(),
      });
      if (revisionError) throw new Error(`Page updated, but revision failed: ${revisionError.message}`);
      await resyncWikiLinksForCurrentUser(existing.id, updated.content);
      return jsonTool({ ok: true, page: updated });
    } catch (err: unknown) {
      return { content: [{ type: "text" as const, text: `Error: ${(err as Error).message}` }], isError: true };
    }
  }
);

server.registerTool(
  "lexicon_run_lint",
  {
    title: "Run Lexicon Health Check",
    description: "Run the Lexicon health check and return deterministic plus AI audit findings.",
    inputSchema: {},
  },
  async () => {
    try {
      const response = await fetch(`${SUPABASE_URL}/functions/v1/wiki-lint`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
          "Content-Type": "application/json",
          "x-menerio-user-id": currentUserId,
        },
        body: JSON.stringify({}),
      });
      const text = await response.text();
      if (!response.ok) return { content: [{ type: "text" as const, text: `Lexicon health check failed: ${response.status} ${text}` }], isError: true };
      return { content: [{ type: "text" as const, text }] };
    } catch (err: unknown) {
      return { content: [{ type: "text" as const, text: `Error: ${(err as Error).message}` }], isError: true };
    }
  }
);

server.registerTool("list_groups", { title: "List Groups", description: "List the user's active Groups with membership counts and goals.", inputSchema: { limit: z.number().optional().default(50) } }, async ({ limit }) => {
  try {
    const safeLimit = clampNumber(limit, 1, 100, 50);
    const { data: groups, error } = await supabase.from("contact_groups").select("id, name, slug, type, purpose, template, color, icon, stages, success_criteria, updated_at").eq("user_id", currentUserId).eq("is_trashed", false).order("updated_at", { ascending: false }).limit(safeLimit);
    if (error) return { content: [{ type: "text" as const, text: `Error: ${error.message}` }], isError: true };
    const ids = (groups || []).map((group: any) => group.id);
    const { data: memberships } = ids.length ? await supabase.from("contact_group_memberships").select("group_id").eq("user_id", currentUserId).in("group_id", ids).is("archived_at", null) : { data: [] };
    const counts = new Map<string, number>();
    for (const membership of memberships || []) counts.set((membership as any).group_id, (counts.get((membership as any).group_id) || 0) + 1);
    return jsonTool({ groups: (groups || []).map((group: any) => ({ ...group, member_count: counts.get(group.id) || 0 })) });
  } catch (err: unknown) {
    return { content: [{ type: "text" as const, text: `Error: ${(err as Error).message}` }], isError: true };
  }
});

server.registerTool("get_group", { title: "Get Group", description: "Get a Group with members, recent interactions, open next steps, goals, and latest briefing.", inputSchema: { id_or_slug: z.string(), include_notes: z.boolean().optional().default(false) } }, async ({ id_or_slug, include_notes }) => {
  try {
    const group = await resolveGroup(id_or_slug);
    const [{ data: memberships }, { data: interactions }, { data: actions }, { data: briefings }] = await Promise.all([
      supabase.from("contact_group_memberships").select("*, contacts:contact_id(id, name, company, role, email, tags)").eq("user_id", currentUserId).eq("group_id", group.id).is("archived_at", null).order("position"),
      supabase.from("contact_interactions").select("id, interaction_date, type, summary, note_id, contact_id, action_items").eq("user_id", currentUserId).eq("group_id", group.id).order("interaction_date", { ascending: false }).limit(10),
      supabase.from("action_items").select("id, content, status, priority, due_date, contact_id, metadata").eq("user_id", currentUserId).eq("status", "open").eq("metadata->>group_id", group.id).order("created_at", { ascending: false }).limit(20),
      supabase.from("group_briefings").select("briefing_markdown, generated_at, period_days").eq("user_id", currentUserId).eq("group_id", group.id).order("generated_at", { ascending: false }).limit(1),
    ]);
    let notes: any[] = [];
    if (include_notes) {
      const names = (memberships || []).map((m: any) => m.contacts?.name).filter(Boolean).slice(0, 20);
      const { data } = names.length ? await supabase.from("notes").select("id, title, content, created_at, metadata").eq("user_id", currentUserId).eq("is_trashed", false).contains("metadata", { people: names }).order("created_at", { ascending: false }).limit(10) : { data: [] };
      notes = data || [];
    }
    return jsonTool({ group, members: memberships || [], recent_interactions: interactions || [], open_next_steps: actions || [], latest_briefing: briefings?.[0] || null, related_notes: notes });
  } catch (err: unknown) {
    return { content: [{ type: "text" as const, text: `Error: ${(err as Error).message}` }], isError: true };
  }
});

server.registerTool("create_group", { title: "Create Group", description: "Create a new Group. Provide name plus optional purpose, type, stages, and success criteria.", inputSchema: { name: z.string(), purpose: z.string().optional(), description: z.string().optional(), type: z.string().optional().default("other"), template: z.string().optional(), stages: z.array(z.any()).optional(), success_criteria: z.array(z.any()).optional(), color: z.string().optional(), icon: z.string().optional() } }, async ({ name, purpose, description, type, template, stages, success_criteria, color, icon }) => {
  try {
    const baseSlug = slugify(name);
    let slug = baseSlug;
    for (let i = 2; i < 20; i++) {
      const { data } = await supabase.from("contact_groups").select("id").eq("user_id", currentUserId).eq("slug", slug).maybeSingle();
      if (!data) break;
      slug = `${baseSlug}-${i}`;
    }
    const { data: group, error } = await supabase.from("contact_groups").insert({ user_id: currentUserId, name: name.trim(), slug, purpose: purpose || null, description: description || null, type: type || "other", template: template || null, stages: stages || [], success_criteria: success_criteria || [], color: color || null, icon: icon || null }).select("*").single();
    if (error) return { content: [{ type: "text" as const, text: `Error: ${error.message}` }], isError: true };
    await supabase.from("wiki_pages").insert({ user_id: currentUserId, slug: `group-${group.slug}`, page_type: "group", title: group.name, summary: group.purpose, metadata: { group_id: group.id }, content: `# ${group.name}\n\n## Purpose\n${group.purpose || ""}\n\n## Members\n_Synced automatically from contact_group_memberships._\n\n## Insights\n_Synthesized from notes mentioning members._\n` });
    return jsonTool({ ok: true, group });
  } catch (err: unknown) {
    return { content: [{ type: "text" as const, text: `Error: ${(err as Error).message}` }], isError: true };
  }
});

server.registerTool("add_group_member", { title: "Add Group Member", description: "Add a person to a Group, or restore the active membership if it already exists.", inputSchema: { group_id_or_slug: z.string(), contact_id: z.string().optional(), contact_name: z.string().optional(), status: z.string().optional(), priority: z.string().optional().default("normal"), reason: z.string().optional(), notes: z.string().optional() } }, async ({ group_id_or_slug, contact_id, contact_name, status, priority, reason, notes }) => {
  try {
    const group = await resolveGroup(group_id_or_slug);
    const contact = await resolveContact({ contact_id, contact_name });
    const { data: existing } = await supabase.from("contact_group_memberships").select("*").eq("user_id", currentUserId).eq("group_id", group.id).eq("contact_id", contact.id).is("archived_at", null).maybeSingle();
    if (existing) return jsonTool({ ok: true, changed: false, membership: existing });
    const { data, error } = await supabase.from("contact_group_memberships").insert({ user_id: currentUserId, group_id: group.id, contact_id: contact.id, status: status || null, priority: priority || "normal", reason: reason || null, notes: notes || null }).select("*").single();
    if (error) return { content: [{ type: "text" as const, text: `Error: ${error.message}` }], isError: true };
    return jsonTool({ ok: true, changed: true, membership: data, group: { id: group.id, name: group.name }, person: { id: contact.id, name: contact.name } });
  } catch (err: unknown) {
    return { content: [{ type: "text" as const, text: `Error: ${(err as Error).message}` }], isError: true };
  }
});

server.registerTool("update_group_membership", { title: "Update Group Membership", description: "Update a Group membership's stage/status, priority, notes, attributes, or archive state.", inputSchema: { membership_id: z.string(), status: z.string().optional(), priority: z.string().optional(), notes: z.string().optional(), reason: z.string().optional(), attributes: z.record(z.string(), z.any()).optional(), archived: z.boolean().optional() } }, async ({ membership_id, status, priority, notes, reason, attributes, archived }) => {
  try {
    if (!isUuid(membership_id)) throw new Error("Invalid membership_id");
    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (status !== undefined) updates.status = status;
    if (priority !== undefined) updates.priority = priority;
    if (notes !== undefined) updates.notes = notes;
    if (reason !== undefined) updates.reason = reason;
    if (attributes !== undefined) updates.attributes = attributes;
    if (archived !== undefined) updates.archived_at = archived ? new Date().toISOString() : null;
    if (status !== undefined) updates.last_movement_at = new Date().toISOString();
    const { data, error } = await supabase.from("contact_group_memberships").update(updates).eq("user_id", currentUserId).eq("id", membership_id).select("*").single();
    if (error) return { content: [{ type: "text" as const, text: `Error: ${error.message}` }], isError: true };
    return jsonTool({ ok: true, membership: data });
  } catch (err: unknown) {
    return { content: [{ type: "text" as const, text: `Error: ${(err as Error).message}` }], isError: true };
  }
});

server.registerTool("log_group_interaction", { title: "Log Group Interaction", description: "Record an interaction with a person in the context of a Group.", inputSchema: { group_id_or_slug: z.string(), contact_id: z.string().optional(), contact_name: z.string().optional(), type: z.string(), summary: z.string().optional(), action_items: z.array(z.string()).optional(), note_id: z.string().optional(), interaction_date: z.string().optional() } }, async ({ group_id_or_slug, contact_id, contact_name, type, summary, action_items, note_id, interaction_date }) => {
  try {
    const group = await resolveGroup(group_id_or_slug);
    const contact = await resolveContact({ contact_id, contact_name });
    const date = interaction_date || new Date().toISOString().slice(0, 10);
    const { data, error } = await supabase.from("contact_interactions").insert({ user_id: currentUserId, group_id: group.id, contact_id: contact.id, type, summary: summary || null, action_items: action_items || [], note_id: note_id || null, interaction_date: date }).select("*").single();
    if (error) return { content: [{ type: "text" as const, text: `Error: ${error.message}` }], isError: true };
    await supabase.from("contacts").update({ last_contact_date: date }).eq("user_id", currentUserId).eq("id", contact.id);
    return jsonTool({ ok: true, interaction: data, group: { id: group.id, name: group.name }, person: { id: contact.id, name: contact.name } });
  } catch (err: unknown) {
    return { content: [{ type: "text" as const, text: `Error: ${(err as Error).message}` }], isError: true };
  }
});

server.registerTool("create_group_next_step", { title: "Create Group Next Step", description: "Create an open next-step action for a Group membership.", inputSchema: { membership_id: z.string(), content: z.string(), priority: z.string().optional().default("normal"), due_date: z.string().optional() } }, async ({ membership_id, content, priority, due_date }) => {
  try {
    const { data: membership, error: membershipError } = await supabase.from("contact_group_memberships").select("id, group_id, contact_id").eq("user_id", currentUserId).eq("id", membership_id).maybeSingle();
    if (membershipError) throw new Error(membershipError.message);
    if (!membership) throw new Error("Membership not found");
    const { data, error } = await supabase.from("action_items").insert({ user_id: currentUserId, contact_id: (membership as any).contact_id, content, priority: priority || "normal", due_date: due_date || null, status: "open", metadata: { group_membership_id: membership_id, group_id: (membership as any).group_id, contact_id: (membership as any).contact_id } }).select("*").single();
    if (error) return { content: [{ type: "text" as const, text: `Error: ${error.message}` }], isError: true };
    return jsonTool({ ok: true, action_item: data });
  } catch (err: unknown) {
    return { content: [{ type: "text" as const, text: `Error: ${(err as Error).message}` }], isError: true };
  }
});

server.registerTool("suggest_group_next_step", { title: "Suggest Group Next Step", description: "Use AI to suggest one concrete next step for a Group membership without saving it.", inputSchema: { membership_id: z.string() } }, async ({ membership_id }) => {
  try {
    const { data: membership, error: membershipError } = await supabase.from("contact_group_memberships").select("*, contact_groups:group_id(*), contacts:contact_id(*)").eq("id", membership_id).eq("user_id", currentUserId).maybeSingle();
    if (membershipError) throw new Error(membershipError.message);
    if (!membership) throw new Error("Membership not found");
    const [{ data: interactions }, { data: notes }] = await Promise.all([
      supabase.from("contact_interactions").select("type, summary, interaction_date, group_id, action_items").eq("user_id", currentUserId).eq("contact_id", (membership as any).contact_id).order("interaction_date", { ascending: false }).limit(5),
      supabase.from("notes").select("title, content, created_at, metadata").eq("user_id", currentUserId).contains("metadata", { people: [(membership as any).contacts?.name] }).order("created_at", { ascending: false }).limit(3),
    ]);
    const { result, credits } = await openRouterWithCredits(supabase, OPENROUTER_API_KEY, currentUserId, "group_next_step", "chat/completions", { model: "openai/gpt-4o-mini", temperature: 0.2, response_format: { type: "json_object" }, messages: [{ role: "system", content: "Suggest one concrete next step for a relationship/group pipeline. Return only JSON with title, due_date_offset_days, priority, reasoning. priority must be low, normal, high, or urgent." }, { role: "user", content: JSON.stringify({ group: (membership as any).contact_groups, person: (membership as any).contacts, recent_interactions: interactions || [], recent_notes: (notes || []).map(noteText) }) }] });
    const parsed = JSON.parse(result?.choices?.[0]?.message?.content || "{}");
    return jsonTool({ title: String(parsed.title || "Follow up"), due_date_offset_days: Number(parsed.due_date_offset_days || 3), priority: ["low", "normal", "high", "urgent"].includes(parsed.priority) ? parsed.priority : "normal", reasoning: String(parsed.reasoning || ""), credits });
  } catch (err: unknown) {
    return { content: [{ type: "text" as const, text: `Error: ${(err as Error).message}` }], isError: true };
  }
});

server.registerTool("generate_group_briefing", { title: "Generate Group Briefing", description: "Generate and save a concise Markdown briefing for a Group.", inputSchema: { group_id_or_slug: z.string(), period_days: z.number().optional().default(7) } }, async ({ group_id_or_slug, period_days }) => {
  try {
    const group = await resolveGroup(group_id_or_slug);
    const days = Math.min(90, Math.max(1, Number(period_days) || 7));
    const since = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
    const [{ data: memberships }, { data: interactions }, { data: actions }] = await Promise.all([
      supabase.from("contact_group_memberships").select("*, contacts:contact_id(name, company, role)").eq("group_id", group.id).eq("user_id", currentUserId).is("archived_at", null).order("last_movement_at", { ascending: true }),
      supabase.from("contact_interactions").select("interaction_date, type, summary, contact_id, group_id").eq("user_id", currentUserId).eq("group_id", group.id).gte("interaction_date", since).order("interaction_date", { ascending: false }),
      supabase.from("action_items").select("content, status, priority, due_date, contact_id, metadata").eq("user_id", currentUserId).eq("metadata->>group_id", group.id).order("created_at", { ascending: false }),
    ]);
    const { result, credits } = await openRouterWithCredits(supabase, OPENROUTER_API_KEY, currentUserId, "group_briefing", "chat/completions", { model: "openai/gpt-4o-mini", temperature: 0.25, messages: [{ role: "system", content: "Generate a concise weekly group briefing in Markdown with these exact sections: ## Movement, ## Stale Members, ## Top Priorities for Next Week, ## Goals Progress. Ground every claim in provided data." }, { role: "user", content: JSON.stringify({ group, period_days: days, memberships: memberships || [], interactions: interactions || [], action_items: actions || [] }) }] });
    const briefing = String(result?.choices?.[0]?.message?.content || "").trim();
    const generatedAt = new Date().toISOString();
    const { error } = await supabase.from("group_briefings").insert({ user_id: currentUserId, group_id: group.id, period_days: days, briefing_markdown: briefing, generated_at: generatedAt });
    if (error) return { content: [{ type: "text" as const, text: `Error: ${error.message}` }], isError: true };
    return jsonTool({ briefing_markdown: briefing, generated_at: generatedAt, credits });
  } catch (err: unknown) {
    return { content: [{ type: "text" as const, text: `Error: ${(err as Error).message}` }], isError: true };
  }
});

server.registerTool("add_members_from_notes", { title: "Add Members From Notes", description: "Use AI to add or propose Group members from notes. Respects the user's AI suggestion settings: auto mode adds eligible members and queues them for review; manual mode sends suggestions to Review Queue.", inputSchema: { group_id_or_slug: z.string() } }, async ({ group_id_or_slug }) => {
  try {
    const group = await resolveGroup(group_id_or_slug);
    const [{ data: memberships }, { data: contacts }, { data: notes }] = await Promise.all([
      supabase.from("contact_group_memberships").select("contact_id, contacts:contact_id(name)").eq("group_id", group.id).eq("user_id", currentUserId).is("archived_at", null),
      supabase.from("contacts").select("id, name, company, role, tags, notes, metadata").eq("user_id", currentUserId).is("merged_into", null).order("name"),
      supabase.from("notes").select("id, title, content, metadata, created_at").eq("user_id", currentUserId).eq("is_trashed", false).order("created_at", { ascending: false }).limit(100),
    ]);
    const structuredImport = await importGroupMembersFromNotes(supabase, currentUserId, group, notes || []);
    if (structuredImport) return jsonTool({ ok: true, mode: "structured_import", ...structuredImport });
    const existingIds = new Set((memberships || []).map((m: any) => m.contact_id));
    const candidates = (contacts || []).filter((contact: any) => !existingIds.has(contact.id));
    const { result, credits } = await openRouterWithCredits(supabase, OPENROUTER_API_KEY, currentUserId, "group_member_suggestions", "chat/completions", { model: "openai/gpt-4o-mini", temperature: 0.2, response_format: { type: "json_object" }, messages: [{ role: "system", content: "Suggest contacts to add to this group. Return JSON: { suggestions: [{ contact_id, contact_name, reasoning, confidence }] }. Use only provided contact_id values. confidence is 0-1." }, { role: "user", content: JSON.stringify({ group, existing_members: (memberships || []).map((m: any) => m.contacts?.name).filter(Boolean), candidates, recent_notes: (notes || []).map(noteText) }) }] });
    const suggestions = Array.isArray(result?.choices?.[0]?.message?.content) ? [] : JSON.parse(result?.choices?.[0]?.message?.content || "{}").suggestions || [];
    const candidateIds = new Set(candidates.map((contact: any) => contact.id));
    const defaultStatus = Array.isArray(group.stages) ? group.stages[0]?.id : null;
    const rawRows = suggestions.filter((suggestion: any) => candidateIds.has(suggestion.contact_id) && Number(suggestion.confidence) > 0.6).map((suggestion: any) => {
      const reasoning = suggestion.reasoning || "";
      const contactId = String(suggestion.contact_id);
      const sensitive = ["health", "medical", "diagnosis", "therapy", "politics", "religion", "financial", "salary", "private", "confidential"].some((term) => `${group.name} ${group.description || ""} ${reasoning}`.toLowerCase().includes(term));
      return { user_id: currentUserId, suggestion_type: "group_member_suggestion", title: `Add ${suggestion.contact_name || "contact"} to ${group.name}`, description: reasoning || null, confidence_score: Number(suggestion.confidence), is_sensitive: sensitive, target_entity_type: "contact_group", target_entity_id: group.id, payload: { group_id: group.id, contact_id: contactId, contact_name: suggestion.contact_name || null, group_name: group.name, reasoning, default_status: defaultStatus }, suppression_key: buildGroupMemberSuppressionKey(group.id, contactId) };
    });
    const filteredRows = await filterSuppressedGroupMemberRows(rawRows);
    const preferences = await getSuggestionPreferences();
    const rows = await Promise.all(filteredRows.map((row) => prepareGroupMemberSuggestion(row, preferences)));
    if (rows.length) {
      const { error } = await supabase.from("review_queue").insert(rows);
      if (error) return { content: [{ type: "text" as const, text: `Error: ${error.message}` }], isError: true };
    }
    return jsonTool({ ok: true, suggestions_added: rows.length, auto_applied: rows.filter((row) => row.status === "auto_applied_unreviewed").length, pending_review: rows.filter((row) => row.status === "pending_review").length, credits });
  } catch (err: unknown) {
    return { content: [{ type: "text" as const, text: `Error: ${(err as Error).message}` }], isError: true };
  }
});

server.registerTool("preview_group_members_from_note", { title: "Preview Group Members From Note", description: "Deterministically preview people that can be imported into a Group from a matching Markdown table or numbered list note. Does not write data.", inputSchema: { group_id_or_slug: z.string() } }, async ({ group_id_or_slug }) => {
  try {
    const group = await resolveGroup(group_id_or_slug);
    const { data: notes, error } = await supabase.from("notes").select("id, title, content, metadata, created_at").eq("user_id", currentUserId).eq("is_trashed", false).order("created_at", { ascending: false }).limit(100);
    if (error) throw new Error(error.message);
    const preview = previewGroupMembersFromNotes(group, notes || []);
    return jsonTool(preview ? { ok: true, source_note: { id: preview.note.id, title: preview.note.title || "Untitled" }, parsed_rows: preview.rows.length, rows: preview.rows.slice(0, 120) } : { ok: true, source_note: null, parsed_rows: 0, rows: [] });
  } catch (err: unknown) {
    return { content: [{ type: "text" as const, text: `Error: ${(err as Error).message}` }], isError: true };
  }
});

server.registerTool("import_group_members_from_note", { title: "Import Group Members From Note", description: "Deterministically import people into a Group from a matching Markdown table or numbered list note. Creates missing contacts, preserves rank/order, saves link/relevance/first-step metadata.", inputSchema: { group_id_or_slug: z.string() } }, async ({ group_id_or_slug }) => {
  try {
    const group = await resolveGroup(group_id_or_slug);
    const { data: notes, error } = await supabase.from("notes").select("id, title, content, metadata, created_at").eq("user_id", currentUserId).eq("is_trashed", false).order("created_at", { ascending: false }).limit(100);
    if (error) throw new Error(error.message);
    const result = await importGroupMembersFromNotes(supabase, currentUserId, group, notes || []);
    return jsonTool(result ? { ok: true, ...result } : { ok: false, error: "No matching structured note found" });
  } catch (err: unknown) {
    return { content: [{ type: "text" as const, text: `Error: ${(err as Error).message}` }], isError: true };
  }
});

server.registerTool("review_group_member_suggestion", { title: "Review Group Member Suggestion", description: "Apply Review Queue actions for Group member suggestions using the same Keep, Roll Back, and Never Again behavior as the app.", inputSchema: { review_queue_id: z.string(), action: z.enum(["keep", "roll_back", "never_again"]) } }, async ({ review_queue_id, action }) => {
  try {
    const { data: item, error: fetchError } = await supabase.from("review_queue").select("*").eq("user_id", currentUserId).eq("id", review_queue_id).eq("suggestion_type", "group_member_suggestion").maybeSingle();
    if (fetchError) throw new Error(fetchError.message);
    if (!item) throw new Error("Group member suggestion not found");
    const payload = (item as any).payload || {};
    let membershipId = (item as any).target_entity_id;
    if (action === "keep") {
      if (!membershipId) {
        const { data: existing } = await supabase.from("contact_group_memberships").select("id").eq("user_id", currentUserId).eq("group_id", payload.group_id).eq("contact_id", payload.contact_id).is("archived_at", null).maybeSingle();
        membershipId = existing?.id;
      }
      if (!membershipId) {
        const { data, error } = await supabase.from("contact_group_memberships").insert({ user_id: currentUserId, group_id: payload.group_id, contact_id: payload.contact_id, status: payload.default_status || null, reason: (item as any).description || null }).select("id").single();
        if (error || !data) throw new Error(error?.message || "Could not create membership");
        membershipId = data.id;
      }
      await supabase.from("review_queue").update({ status: "kept", target_entity_type: "contact_group_membership", target_entity_id: membershipId, applied_at: (item as any).applied_at || new Date().toISOString(), reviewed_at: new Date().toISOString() }).eq("id", review_queue_id).eq("user_id", currentUserId);
      return jsonTool({ ok: true, status: "kept", membership_id: membershipId });
    }
    if (membershipId) await supabase.from("contact_group_memberships").delete().eq("user_id", currentUserId).eq("id", membershipId);
    if (action === "never_again") await supabase.from("ai_suggestion_suppressions").upsert({ user_id: currentUserId, suggestion_type: "group_member_suggestion", target_entity_type: (item as any).target_entity_type, target_entity_id: (item as any).target_entity_id, normalized_value: String(payload.contact_id || "").toLowerCase(), source_category: null, suppression_key: (item as any).suppression_key || buildGroupMemberSuppressionKey(payload.group_id, payload.contact_id) }, { onConflict: "user_id,suppression_key" });
    await supabase.from("review_queue").update({ status: action === "never_again" ? "blocked" : "removed", blocked_at: action === "never_again" ? new Date().toISOString() : null, reviewed_at: new Date().toISOString() }).eq("id", review_queue_id).eq("user_id", currentUserId);
    return jsonTool({ ok: true, status: action === "never_again" ? "blocked" : "removed" });
  } catch (err: unknown) {
    return { content: [{ type: "text" as const, text: `Error: ${(err as Error).message}` }], isError: true };
  }
});

server.registerTool("list_collections", { title: "List Collections", description: "List all collections the user has created. Returns each collection's name, slug, description, icon, and the agent_instructions that explain how to capture into it. Call this once at the start of a session, or whenever the user mentions a topic that might fit an existing collection, to know what's available.", inputSchema: {} }, async () => {
  return withLoggedCollectionTool("list_collections", {}, async () => {
    const { data, error } = await supabase.from("collections").select("id, slug, name, icon, description, agent_instructions, field_schema").eq("user_id", currentUserId).order("updated_at", { ascending: false });
    if (error) throw new Error(error.message);
    const counts = await collectionItemCounts((data || []).map((collection: any) => collection.id));
    return (data || []).map((collection: any) => ({
      slug: collection.slug,
      name: collection.name,
      icon: collection.icon,
      description: collection.description,
      agent_instructions: collection.agent_instructions,
      item_count: counts.get(collection.id) || 0,
      field_count: Array.isArray(collection.field_schema) ? collection.field_schema.length : 0,
    }));
  });
});

server.registerTool("get_collection_schema", { title: "Get Collection Schema", description: "Get the full field schema for a specific collection, including each field's key, label, type, and options. Call this before adding or updating items so you know the exact fields and their constraints.", inputSchema: { slug: z.string() } }, async ({ slug }) => {
  return withLoggedCollectionTool("get_collection_schema", { slug }, async () => {
    const collection = await getCollectionBySlug(slug);
    const counts = await collectionItemCounts([collection.id]);
    return {
      slug: collection.slug,
      name: collection.name,
      field_schema: Array.isArray(collection.field_schema) ? collection.field_schema : [],
      agent_instructions: collection.agent_instructions,
      item_count: counts.get(collection.id) || 0,
    };
  });
});

const addCollectionItemTool = server.registerTool("add_collection_item", { title: "Add Collection Item", description: "Add a new item to a collection. The user has defined custom collections — call list_collections first to see what's available, then get_collection_schema to know the fields. Pay close attention to each collection's agent_instructions, which describe when and how to capture entries. For sensitive collections (visibility=private), confirm with the user before saving.", inputSchema: { collection_slug: z.string(), data: z.record(z.string(), z.any()) } }, async ({ collection_slug, data }) => {
  return withLoggedCollectionTool("add_collection_item", { collection_slug, data }, async () => {
    const collection = await getCollectionBySlug(collection_slug);
    validateCollectionData(collection, data || {});
    const { data: item, error } = await supabase.from("collection_items").insert({ user_id: currentUserId, collection_id: collection.id, data }).select("id, title").single();
    if (error || !item) throw new Error(error?.message || "Could not add collection item");
    return { id: item.id, title: item.title, collection_slug: collection.slug, item_url: collectionItemUrl(collection.slug, item.id) };
  });
});

server.registerTool("update_collection_item", { title: "Update Collection Item", description: "Update an existing item in a collection. Useful for status changes, follow-up updates, adding notes to an existing entry.", inputSchema: { item_id: z.string(), data: z.record(z.string(), z.any()) } }, async ({ item_id, data }) => {
  return withLoggedCollectionTool("update_collection_item", { item_id, data }, async () => {
    const { data: existing, error: existingError } = await supabase.from("collection_items").select("id, collection_id, data, collections:collection_id(*)").eq("user_id", currentUserId).eq("id", item_id).maybeSingle();
    if (existingError) throw new Error(existingError.message);
    if (!existing) throw new Error("Collection item not found");
    const collection = (existing as any).collections;
    validateCollectionData(collection, data || {});
    const merged = { ...((existing as any).data || {}), ...(data || {}) };
    const { data: updated, error } = await supabase.from("collection_items").update({ data: merged }).eq("user_id", currentUserId).eq("id", item_id).select("id, title, updated_at").single();
    if (error || !updated) throw new Error(error?.message || "Could not update collection item");
    return { id: updated.id, title: updated.title, updated_at: updated.updated_at };
  });
});

server.registerTool("list_collection_items", { title: "List Collection Items", description: "Search and list items within a specific collection. Supports text search and filtering by indexable date/number/text columns. Use this to retrieve context — 'what was the last thing I logged about X', 'what's coming up', 'who hasn't been followed up with'.", inputSchema: { collection_slug: z.string(), search: z.string().optional(), limit: z.number().optional().default(20), date_from: z.string().optional(), date_to: z.string().optional(), status: z.string().optional(), sort: z.enum(["recent", "oldest", "updated"]).optional().default("recent") } }, async ({ collection_slug, search, limit, date_from, date_to, status, sort }) => {
  return withLoggedCollectionTool("list_collection_items", { collection_slug, search, limit, date_from, date_to, status, sort }, async () => {
    const collection = await getCollectionBySlug(collection_slug);
    const cappedLimit = Math.min(100, Math.max(1, Number(limit) || 20));
    let q = supabase.from("collection_items").select("id, title, data, updated_at, created_at").eq("user_id", currentUserId).eq("collection_id", collection.id).limit(cappedLimit);
    if (search) q = q.textSearch("search_vector", search, { type: "websearch", config: "simple" });
    if (date_from) q = q.gte("indexable_date_1", date_from);
    if (date_to) q = q.lte("indexable_date_1", date_to);
    if (status) q = q.eq("indexable_text_1", status);
    if (sort === "oldest") q = q.order("created_at", { ascending: true });
    else if (sort === "updated") q = q.order("updated_at", { ascending: false });
    else q = q.order("created_at", { ascending: false });
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    return (data || []).map((item: any) => ({ id: item.id, title: item.title, data: item.data, updated_at: item.updated_at }));
  });
});

server.registerTool("search_all_collections", { title: "Search All Collections", description: "Search across all of the user's collections at once. Useful when the user references something but you don't know which collection it might be in.", inputSchema: { query: z.string(), limit: z.number().optional().default(20) } }, async ({ query, limit }) => {
  return withLoggedCollectionTool("search_all_collections", { query, limit }, async () => {
    const cappedLimit = Math.min(100, Math.max(1, Number(limit) || 20));
    const { data, error } = await supabase.from("collection_items").select("id, title, data, collections:collection_id(slug, name)").eq("user_id", currentUserId).textSearch("search_vector", query, { type: "websearch", config: "simple" }).order("updated_at", { ascending: false }).limit(cappedLimit);
    if (error) throw new Error(error.message);
    return (data || []).map((item: any) => {
      const flat = Object.values(item.data || {}).map((value) => typeof value === "object" ? JSON.stringify(value) : String(value)).join(" ");
      const idx = flat.toLowerCase().indexOf(query.toLowerCase());
      const snippet = idx >= 0 ? flat.slice(Math.max(0, idx - 60), idx + query.length + 120) : flat.slice(0, 180);
      return { collection_slug: item.collections?.slug, collection_name: item.collections?.name, item_id: item.id, item_title: item.title, snippet };
    });
  });
});

const app = new Hono();

// Serve favicon so Claude/ChatGPT show the Menerio logo
app.get("/favicon.ico", (c) => {
  return c.redirect("https://menerio.com/favicon.png", 302);
});
app.get("/favicon.png", (c) => {
  return c.redirect("https://menerio.com/favicon.png", 302);
});

app.options("*", (c) => new Response(null, { status: 204, headers: c.res.headers }));

function getAuthHeader(c: {
  req: {
    header: (name: string) => string | undefined;
    query: (name: string) => string | undefined;
  };
}) {
  const headerToken =
    c.req.header("authorization") ||
    c.req.header("Authorization") ||
    c.req.header("x-mcp-token") ||
    c.req.header("x-api-key");
  if (headerToken) return headerToken;

  // Some MCP clients (e.g. ChatGPT custom connectors) attach the token
  // to the URL as a query parameter instead of an Authorization header.
  const queryToken =
    c.req.query("key") ||
    c.req.query("token") ||
    c.req.query("access_token") ||
    c.req.query("api_key");
  return queryToken ? `Bearer ${queryToken}` : undefined;
}


app.all("*", async (c) => {
  const authHeader = getAuthHeader(c);
  const method = c.req.method;

  // Discovery / health probes — no auth required so MCP clients (Craig, Claude, etc.)
  // don't fail their initial endpoint check before sending the authenticated POST.
  if (method === "HEAD") {
    return new Response(null, {
      status: 200,
      headers: { "WWW-Authenticate": 'Bearer realm="MCP"' },
    });
  }

  // Unauthenticated GET → return server metadata (no user data).
  if (!authHeader && method === "GET") {
    return c.json({
      name: "open-brain",
      version: "1.0.0",
      transport: "streamable-http",
      auth: "Authorization: Bearer mnr_mcp_<token>",
    });
  }

  const auth = await authenticateMcpRequest(authHeader);

  if (auth.error) {
    console.warn("MCP request rejected", {
      method: c.req.method,
      path: new URL(c.req.url).pathname,
      has_auth_header: Boolean(authHeader),
      auth_scheme: authHeader
        ? (authHeader.toLowerCase().startsWith("bearer ") ? "bearer" : "other")
        : "none",
    });
    return c.json({ error: auth.error.message }, auth.error.status as 401);
  }

  currentUserId = auth.userId!;
  addCollectionItemTool.update({ description: await buildAddCollectionItemDescription() });

  const transport = new StreamableHTTPTransport();
  await server.connect(transport);
  return transport.handleRequest(c);
});

Deno.serve(app.fetch);
