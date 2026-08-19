import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { AsyncLocalStorage } from "node:async_hooks";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPTransport } from "@hono/mcp";
import { Hono } from "hono";
import { z } from "zod";
import { createClient } from "@supabase/supabase-js";
import { openRouterWithCredits } from "../_shared/llm-credits.ts";
import { importGroupMembersFromNotes, previewGroupMembersFromNotes } from "../_shared/group-note-import.ts";
import { embedAndStoreNoteChunks } from "../_shared/chunk-embeddings.ts";
import { addClaimWithSupersede, changedSince, isCurrentClaim, isReservedAttribute, normalizeAttribute, sortClaims, todayISO } from "../_shared/claims.ts";
import { lookupHubKey } from "../_shared/hub-auth.ts";
import { ilikeAnyColumn } from "../_shared/postgrest-filters.ts";
import {
  applyVisibility,
  assertWritable,
  enterVisibilityScope,
  filterVisibleNotes,
  getSensitivePersonIds,
  redactContactList,
  redactSensitiveContact,
} from "./_ai_visibility.ts";


const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const OPENROUTER_API_KEY = Deno.env.get("OPENROUTER_API_KEY")!;
const OPENROUTER_BASE = "https://openrouter.ai/api/v1";
const MCP_TOKEN_PREFIX = "mnr_mcp_";
const MCP_TOKEN_PATTERN = /^mnr_mcp_[A-Za-z0-9_-]{43}$/;
// Retired connector scope: it used to gate this endpoint. Now every active API
// key authenticates here and the data scopes decide which tools answer, so the
// only job left for "hub" is to be ignored when an old key still carries it.
const RETIRED_HUB_SCOPE = "hub";
const INVALID_TOKEN_FORMAT_MESSAGE =
  "Invalid key format. This MCP server accepts any Menerio API key (prefix `mnr_`) from Menerio → Settings → API Keys.";
const MALFORMED_MCP_TOKEN_MESSAGE =
  "That looks like an older Personal MCP Token but its shape is wrong. Use a Menerio API key from Settings → API Keys instead.";
const RESPONSE_CHAR_BUDGET = 6000; // hard cap on a search tool's total text response
const SNIPPET_CAP = 320;           // max chars per result snippet
const CANDIDATE_CAP = 50;          // max ranked candidates hybrid search returns

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// Per-request user ID and key scopes — stored in AsyncLocalStorage so
// concurrent requests can never observe each other's authenticated identity.
// scopes is "all" for legacy mnr_mcp_ tokens, which were never scoped.
const requestContext = new AsyncLocalStorage<{ userId: string; scopes: string[] | "all" }>();
function getCurrentUserId(): string {
  const store = requestContext.getStore();
  if (!store?.userId) {
    throw new Error("MCP request context missing — tool invoked outside an authenticated request scope");
  }
  return store.userId;
}
function getCurrentScopes(): string[] | "all" {
  const store = requestContext.getStore();
  if (!store?.scopes) {
    throw new Error("MCP request context missing — tool invoked outside an authenticated request scope");
  }
  return store.scopes;
}

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
    return { userId: null, scopes: null, error: { status: 401, message: "Missing Authorization header. Create an API key in Settings → API Keys and send it as `Authorization: Bearer <key>`." } };
  }

  if (!token.startsWith(MCP_TOKEN_PREFIX)) {
    // Any other mnr_ key is an API key. Every active key opens this door; the
    // data scopes it carries decide which tools answer, checked per tool call.
    // Older mnr_mcp_ tokens keep working through the branch below.
    if (token.startsWith("mnr_")) {
      const { result, errorMessage } = await lookupHubKey(token, supabase);
      if (!result) {
        console.warn("MCP API key rejected", {
          reason: errorMessage,
          token_prefix: token.slice(0, 12),
        });
        return { userId: null, scopes: null, error: { status: 401, message: errorMessage ?? "Invalid or revoked key." } };
      }
      const dataScopes = result.scopes.filter((s) => s !== RETIRED_HUB_SCOPE);
      return { userId: result.userId, scopes: dataScopes, error: null };
    }
    return { userId: null, scopes: null, error: { status: 401, message: INVALID_TOKEN_FORMAT_MESSAGE } };
  }

  if (!MCP_TOKEN_PATTERN.test(token)) {
    console.warn("MCP token rejected due to invalid shape", {
      token_prefix: token.slice(0, 16),
      token_length: token.length,
    });
    return { userId: null, scopes: null, error: { status: 401, message: MALFORMED_MCP_TOKEN_MESSAGE } };
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
    return { userId: null, scopes: null, error: { status: 401, message: "Invalid or revoked token." } };
  }

  // Legacy personal MCP tokens predate scopes and were always all-or-nothing.
  return { userId: tokenRow.user_id as string, scopes: "all" as const, error: null };
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
      model: "deepseek/deepseek-v4-flash",
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: `Extract metadata from the user's captured note. Return JSON with:
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
  const snippet = (t as any).chunk_snippet as string | undefined;
  if (snippet && (t as any).exact_phrase_match) {
    parts.push(`Match: ${snippet}`);
  }
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

// Bounded formatter — NEVER includes the full note body. Used by all search-style tools.
function formatNoteResult(
  t: {
    id?: string;
    title?: string;
    content?: string;
    metadata?: Record<string, unknown>;
    created_at?: string;
    updated_at?: string;
    tags?: string[];
    chunk_snippet?: string;
  },
  i: number,
  score?: number,
  view: "snippet" | "metadata" = "snippet",
  query?: string,
): string {
  const m = (t.metadata || {}) as Record<string, unknown>;
  const parts: string[] = [];
  const scoreStr = score != null ? ` (${(score * 100).toFixed(1)}% match)` : "";
  parts.push(`--- Result ${i + 1}${scoreStr} ---`);
  parts.push(`Title: ${t.title || "Untitled"}`);
  parts.push(`ID: ${t.id || ""}`);
  const dateStr = t.updated_at || t.created_at;
  parts.push(`Updated: ${dateStr ? new Date(dateStr).toISOString().slice(0, 10) : "unknown"}`);
  parts.push(`Type: ${(m.type as string) || "unknown"}`);

  if (view === "metadata") return parts.join("\n");

  const tags = Array.isArray(t.tags) ? (t.tags as string[]) : [];
  if (tags.length) parts.push(`Tags: ${tags.join(", ")}`);

  let snippet = "";
  if (t.chunk_snippet) {
    snippet = t.chunk_snippet;
  } else {
    const haystack = `${t.title || ""}\n${t.content || ""}`;
    if (query) {
      const hit = findFirstPhraseMatch(haystack, buildBoostPhrases(query));
      if (hit) snippet = buildWindowSnippet(haystack, hit.index, hit.length);
    }
    if (!snippet) snippet = (t.content || "").slice(0, SNIPPET_CAP);
  }
  snippet = snippet.replace(/\s+/g, " ").trim();
  if (snippet.length > SNIPPET_CAP) snippet = snippet.slice(0, SNIPPET_CAP - 1) + "…";
  parts.push(`Match: ${snippet}`);

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
    user_id: getCurrentUserId(),
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
    .eq("user_id", getCurrentUserId())
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
    const { count } = await supabase.from("collection_items").select("id", { count: "exact", head: true }).eq("user_id", getCurrentUserId()).eq("collection_id", id);
    return [id, count || 0] as const;
  }));
  return new Map(pairs);
}

async function getCollectionBySlug(slug: string) {
  const { data, error } = await supabase.from("collections").select("*").eq("user_id", getCurrentUserId()).eq("slug", slug).maybeSingle();
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
  const { data: collections, error } = await supabase.from("collections").select("id, slug, name, icon, agent_instructions, updated_at").eq("user_id", getCurrentUserId()).order("updated_at", { ascending: false });
  if (error || !collections?.length) return [];
  if (collections.length <= limit) return collections as any[];

  const { data: items } = await supabase.from("collection_items").select("collection_id, updated_at").eq("user_id", getCurrentUserId()).order("updated_at", { ascending: false }).limit(200);
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
  const query = supabase.from("contact_groups").select("*").eq("user_id", getCurrentUserId()).eq("is_trashed", false);
  const { data, error } = isUuid(idOrSlug) ? await query.eq("id", idOrSlug).maybeSingle() : await query.eq("slug", idOrSlug).maybeSingle();
  if (error) throw new Error(`Could not load group: ${error.message}`);
  if (!data) throw new Error("Group not found");
  return data as any;
}

async function resolveContact(params: { contact_id?: string; contact_name?: string }) {
  if (params.contact_id) {
    const { data, error } = await supabase.from("contacts").select("*").eq("user_id", getCurrentUserId()).eq("id", params.contact_id).is("merged_into", null).maybeSingle();
    if (error) throw new Error(`Could not load person: ${error.message}`);
    if (data) return data as any;
  }
  if (params.contact_name) {
    const { data, error } = await supabase.from("contacts").select("*").eq("user_id", getCurrentUserId()).ilike("name", `%${params.contact_name}%`).is("merged_into", null).limit(1);
    if (error) throw new Error(`Could not load person: ${error.message}`);
    if (data?.[0]) return data[0] as any;
  }
  throw new Error("Person not found");
}

function buildGroupMemberSuppressionKey(groupId: string, contactId: string) {
  return ["group_member_suggestion", "contact_group", groupId, String(contactId).trim().toLowerCase()].join(":");
}

async function getSuggestionPreferences() {
  const { data } = await supabase.from("ai_suggestion_preferences").select("suggestion_mode, suggestion_sensitivity, auto_add_sensitive").eq("user_id", getCurrentUserId()).maybeSingle();
  return { mode: data?.suggestion_mode || "auto", sensitivity: data?.suggestion_sensitivity || "balanced", autoAddSensitive: data?.auto_add_sensitive === true };
}

async function filterSuppressedGroupMemberRows(rows: any[]) {
  const keys = rows.map((row) => row.suppression_key).filter(Boolean);
  if (!keys.length) return rows;
  const { data } = await supabase.from("ai_suggestion_suppressions").select("suppression_key").eq("user_id", getCurrentUserId()).in("suppression_key", keys);
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
  const { data: existing } = await supabase.from("contact_group_memberships").select("id").eq("user_id", getCurrentUserId()).eq("group_id", group_id).eq("contact_id", contact_id).is("archived_at", null).maybeSingle();
  if (existing?.id) return { ...row, status: "auto_applied_unreviewed", target_entity_type: "contact_group_membership", target_entity_id: existing.id, applied_at: new Date().toISOString() };
  const { data, error } = await supabase.from("contact_group_memberships").insert({ user_id: getCurrentUserId(), group_id, contact_id, status: row.payload?.default_status || null, reason: row.description || null }).select("id").single();
  if (error || !data) return { ...row, status: "pending_review" };
  return { ...row, status: "auto_applied_unreviewed", target_entity_type: "contact_group_membership", target_entity_id: data.id, applied_at: new Date().toISOString(), is_sensitive: row.is_sensitive ?? sensitiveTerms.some((term) => String(row.description || "").toLowerCase().includes(term)) };
}

const WIKI_PAGE_TYPES = ["entity", "concept", "source", "overview", "synthesis", "person"] as const;

function extractWikiSlugs(content: string) {
  return Array.from(new Set(Array.from(content.matchAll(/\[\[([a-z0-9-]+)\]\]/g)).map((match) => match[1])));
}

async function resyncWikiLinksForCurrentUser(pageId: string, content: string) {
  const targetSlugs = extractWikiSlugs(content);
  await supabase.from("wiki_links").delete().eq("user_id", getCurrentUserId()).eq("source_page_id", pageId);

  if (!targetSlugs.length) return;

  const { data: targets, error } = await supabase
    .from("wiki_pages")
    .select("id, slug")
    .eq("user_id", getCurrentUserId())
    .in("slug", targetSlugs);
  if (error) throw new Error(`Could not resolve wiki links: ${error.message}`);

  const targetBySlug = new Map((targets || []).map((page: any) => [page.slug, page.id]));
  const rows = targetSlugs.map((slug) => ({
    user_id: getCurrentUserId(),
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
      .eq("user_id", getCurrentUserId())
      .is("merged_into", null)
      .ilike("name", name)
      .limit(1);
    if (existing?.[0]) {
      contacts.push(existing[0]);
      continue;
    }
    const { data, error } = await supabase.from("contacts").insert({ user_id: getCurrentUserId(), name }).select("id, name, relationship").single();
    if (error) throw new Error(`Could not create person '${name}': ${error.message}`);
    contacts.push(data);
  }
  return contacts;
}

// --- MCP Server Setup ---
const server = new McpServer({
  name: "menerio",
  version: "1.0.0",
});

// ---------------------------------------------------------------------------
// Per-tool scope gating. A key is a door; the scope boxes are rooms. Every
// active key opens the door, and each tool checks its own room when called,
// so a narrowed key gets a refusal that names the exact box to tick.
// The map below must name every registered tool — registerTool throws at
// startup on a missing entry, so a new tool cannot ship ungated by accident.
// ---------------------------------------------------------------------------
const SCOPE_LABELS: Record<string, string> = {
  profile: "Profile",
  notes: "Notes",
  contacts: "Contacts",
  actions: "Actions",
  graph: "Graph",
  media: "Media",
  stats: "Stats",
  world: "World",
  lexicon: "Lexicon",
  collections: "Collections",
};

const TOOL_SCOPES: Record<string, string> = {
  // notes
  search_notes: "notes",
  get_note: "notes",
  list_recent_notes: "notes",
  capture_note: "notes",
  update_note: "notes",
  trash_note: "notes",
  get_person_notes: "notes",
  search_brain: "notes",
  search_thoughts: "notes",
  list_recent: "notes",
  capture_thought: "notes",
  // stats / actions / profile
  get_stats: "stats",
  get_action_items: "actions",
  get_user_profile: "profile",
  // contacts and groups
  search_contacts: "contacts",
  get_contact_context: "contacts",
  get_contact_profile: "contacts",
  list_people: "contacts",
  log_interaction: "contacts",
  list_groups: "contacts",
  get_group: "contacts",
  create_group: "contacts",
  add_group_member: "contacts",
  update_group_membership: "contacts",
  log_group_interaction: "contacts",
  create_group_next_step: "contacts",
  suggest_group_next_step: "contacts",
  generate_group_briefing: "contacts",
  add_members_from_notes: "contacts",
  preview_group_members_from_note: "contacts",
  import_group_members_from_note: "contacts",
  review_group_member_suggestion: "contacts",
  // world: moments, entities, claims
  list_moments: "world",
  search_moments: "world",
  create_moment_with_ai: "world",
  create_moment_raw: "world",
  create_moment: "world",
  create_entity: "world",
  search_entities: "world",
  get_entity_context: "world",
  add_claim: "world",
  get_claims: "world",
  // graph
  get_connected_notes: "graph",
  find_path: "graph",
  get_clusters: "graph",
  // media
  search_images: "media",
  get_note_media: "media",
  // lexicon
  lexicon_search: "lexicon",
  lexicon_get_page: "lexicon",
  lexicon_create_page: "lexicon",
  lexicon_update_page: "lexicon",
  lexicon_run_lint: "lexicon",
  // collections
  list_collections: "collections",
  get_collection_schema: "collections",
  add_collection_item: "collections",
  update_collection_item: "collections",
  list_collection_items: "collections",
  search_all_collections: "collections",
};

function scopeRefusal(scope: string) {
  const label = SCOPE_LABELS[scope] ?? scope;
  return {
    content: [{
      type: "text" as const,
      text: `This key's boxes don't include ${label}. Open Menerio → Settings → API Keys and tick ${label} on this key, or use a key that has it.`,
    }],
    isError: true,
  };
}

// Wrap registerTool once so every tool, present and future, is scope-checked
// at invocation time. Listing stays ungated; the refusal happens on call.
{
  const registerToolUnscoped = server.registerTool.bind(server);
  // deno-lint-ignore no-explicit-any
  (server as any).registerTool = (name: string, meta: unknown, handler: (...args: any[]) => any) => {
    const scope = TOOL_SCOPES[name];
    if (!scope) {
      throw new Error(`Tool "${name}" has no entry in TOOL_SCOPES — every tool must name the scope that gates it.`);
    }
    // deno-lint-ignore no-explicit-any
    const gated = async (...args: any[]) => {
      const scopes = getCurrentScopes();
      if (scopes !== "all" && !scopes.includes(scope)) {
        return scopeRefusal(scope);
      }
      return await handler(...args);
    };
    return registerToolUnscoped(name, meta as never, gated as never);
  };
}

// Relationship synonyms — terms that, when present in a query, mark it as a
// first-person personal-fact question. Used to boost exact-phrase hits and to
// derive a relationships block in get_user_profile.
const RELATIONSHIP_TERMS = [
  "wife", "husband", "spouse", "partner", "girlfriend", "boyfriend",
  "fiance", "fiancee", "fiancé", "fiancée",
  "mom", "mother", "dad", "father", "parent", "parents",
  "sister", "brother", "sibling", "siblings",
  "son", "daughter", "kid", "kids", "child", "children",
  "uncle", "aunt", "cousin",
  "grandma", "grandpa", "grandmother", "grandfather",
  "boss", "manager", "colleague", "coworker", "employee", "assistant",
  "friend", "best friend", "roommate", "neighbor",
];

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Find the first whole-word match of any phrase in content (case-insensitive).
// Phrases longer than 1 word match as a phrase; single words match whole-word.
function findFirstPhraseMatch(content: string, phrases: string[]): { index: number; length: number } | null {
  if (!content) return null;
  let best: { index: number; length: number } | null = null;
  for (const p of phrases) {
    const phrase = p.trim();
    if (!phrase) continue;
    const re = new RegExp(`\\b${escapeRegex(phrase)}\\b`, "i");
    const m = re.exec(content);
    if (m && m.index >= 0 && (best === null || m.index < best.index)) {
      best = { index: m.index, length: m[0].length };
    }
  }
  return best;
}

// Build a ±200-char snippet window centered on the match, collapsing whitespace.
function buildWindowSnippet(content: string, matchIndex: number, matchLength: number, radius = 200): string {
  const start = Math.max(0, matchIndex - radius);
  const end = Math.min(content.length, matchIndex + matchLength + radius);
  const prefix = start > 0 ? "…" : "";
  const suffix = end < content.length ? "…" : "";
  const slice = content.slice(start, end).replace(/\s+/g, " ").trim();
  return `${prefix}${slice}${suffix}`;
}

// Given the original query, return the set of phrases we look for to boost
// (query tokens >= 3 chars, plus relationship synonyms if any term is present).
function buildBoostPhrases(query: string): string[] {
  const q = query.toLowerCase();
  const tokens = q.split(/[^a-zà-ÿ0-9]+/i).filter((t) => t.length >= 3);
  const phrases = new Set<string>(tokens);
  // If the query is about a personal relationship, also boost the synonym set
  // and a few common assertion phrases so "Xihui is my wife" lands at the top
  // even when the user asked "name of my wife".
  const hitsRelationship = tokens.some((t) => RELATIONSHIP_TERMS.includes(t));
  if (hitsRelationship) {
    for (const t of RELATIONSHIP_TERMS) phrases.add(t);
    for (const t of RELATIONSHIP_TERMS) {
      phrases.add(`is my ${t}`);
      phrases.add(`my ${t}`);
      phrases.add(`${t}:`);
    }
  }
  return Array.from(phrases);
}

// Helper: hybrid notes search (chunk-level semantic + ILIKE), reusable by search_notes and search_brain
async function hybridSearchNotes(query: string, limit: number, threshold: number): Promise<{ rows: any[]; total: number; mode: string }> {
  let semanticResults: any[] = [];
  let semanticOk = false;
  try {
    const qEmb = await getEmbedding(query);
    const { data, error } = await supabase.rpc("match_note_chunks", {
      query_embedding: qEmb,
      match_threshold: threshold,
      match_count: Math.max(CANDIDATE_CAP, 30),
      p_user_id: getCurrentUserId(),
    });
    if (!error && data) {
      // Aggregate chunks by note_id (best chunk wins) and hydrate.
      const byNote = new Map<string, any>();
      for (const c of data as any[]) {
        const ex = byNote.get(c.note_id);
        if (!ex || c.similarity > ex.similarity) {
          byNote.set(c.note_id, {
            id: c.note_id,
            title: c.note_title,
            similarity: c.similarity,
            chunk_snippet: String(c.content || "").slice(0, 320),
            chunk_heading_path: c.heading_path,
            created_at: c.note_created_at,
          });
        }
      }
      const ids = Array.from(byNote.keys());
      if (ids.length > 0) {
        const { data: rows } = await supabase
          .from("notes")
          .select("id, title, content, metadata, tags, created_at, updated_at, ai_visibility")
          .in("id", ids);
        for (const r of (rows || []) as any[]) {
          const ex = byNote.get(r.id);
          if (ex) byNote.set(r.id, { ...r, ...ex, content: r.content });
        }
      }
      semanticResults = Array.from(byNote.values()).sort((a, b) => b.similarity - a.similarity);
      semanticOk = true;
    }
  } catch (_embErr) {
    console.warn("Semantic search failed, using text fallback only:", _embErr);
  }

  // ILIKE text fallback — inside .or() filter strings PostgREST/supabase-js use `*` (not `%`)
  // as the wildcard. Strip commas/parens/quotes that would break the .or() parser, then build
  // the predicate with `*…*`.
  const q = query.replace(/[,()'"\\*]/g, " ").replace(/\s+/g, " ").trim();
  let textQuery = supabase
    .from("notes")
    .select("id, title, content, metadata, tags, created_at, updated_at, ai_visibility")
    .eq("user_id", getCurrentUserId())
    .eq("is_trashed", false)
    .or(ilikeAnyColumn(["title", "content"], q))
    .order("updated_at", { ascending: false })
    .limit(CANDIDATE_CAP);
  textQuery = await applyVisibility(textQuery, "notes", supabase, getCurrentUserId());
  const { data: textResults } = await textQuery;

  const seenIds = new Set<string>();
  const merged: any[] = [];
  for (const r of await filterVisibleNotes(semanticResults, supabase, getCurrentUserId())) {
    seenIds.add(r.id);
    merged.push(r);
  }
  const visibleText = await filterVisibleNotes(textResults || [], supabase, getCurrentUserId());
  for (const r of visibleText) {
    if (!seenIds.has(r.id)) {
      seenIds.add(r.id);
      merged.push({ ...r, similarity: null });
    }
  }

  // Exact-phrase boost: rows whose content contains a query-token or
  // relationship-synonym phrase get a meaningful snippet centered on the hit.
  const phrases = buildBoostPhrases(query);
  for (const r of merged) {
    const haystack = `${r.title || ""}\n${r.content || ""}`;
    const hit = findFirstPhraseMatch(haystack, phrases);
    if (hit) {
      if (!r.chunk_snippet) r.chunk_snippet = buildWindowSnippet(haystack, hit.index, hit.length);
      r.exact_phrase_match = true;
    }
  }

  // Tiered deterministic ranking — exact/prefix title matches always win.
  const qn = (query || "").trim().toLowerCase();
  const tierOf = (r: any) => {
    const title = (r.title || "").trim().toLowerCase();
    if (qn && title === qn) return 0;
    if (qn && title.startsWith(qn)) return 1;
    if (qn && title.includes(qn)) return 2;
    if (r.exact_phrase_match) return 3;
    if (r.similarity != null) return 4;
    return 5;
  };
  const ranked = merged
    .map((r, idx) => ({ r, idx, tier: tierOf(r) }))
    .sort((a, b) =>
      a.tier - b.tier ||
      ((b.r.similarity ?? -1) - (a.r.similarity ?? -1)) ||
      (new Date(b.r.updated_at || b.r.created_at || 0).getTime() - new Date(a.r.updated_at || a.r.created_at || 0).getTime()) ||
      (a.idx - b.idx)
    )
    .map((x) => x.r);

  // For title-tier rows without a snippet, synthesize one from title+body.
  for (const r of ranked) {
    if (r.chunk_snippet) continue;
    const title = (r.title || "").toLowerCase();
    if (!qn || (!title.includes(qn))) continue;
    const body = r.content || "";
    if (body) {
      const hit = findFirstPhraseMatch(`${r.title || ""}\n${body}`, [qn]);
      if (hit) {
        r.chunk_snippet = buildWindowSnippet(`${r.title || ""}\n${body}`, hit.index, hit.length);
      } else {
        r.chunk_snippet = body.slice(0, SNIPPET_CAP);
      }
    } else {
      r.chunk_snippet = r.title || "";
    }
  }

  return { rows: ranked.slice(0, CANDIDATE_CAP), total: ranked.length, mode: semanticOk ? "semantic+text" : "text_only" };
}




// Helper: Lexicon (wiki) ILIKE search, reusable by lexicon_search and search_brain
async function searchLexiconPages(query: string, limit: number): Promise<any[]> {
  // Inside .or() use `*` as ILIKE wildcard, not `%`. Strip chars that would break the .or() parser.
  const q = String(query || "").replace(/[,()'"\\*]/g, " ").replace(/\s+/g, " ").trim();
  const { data } = await supabase
    .from("wiki_pages")
    .select("slug, title, page_type, summary, source_count, updated_at")
    .eq("user_id", getCurrentUserId())
    .or(ilikeAnyColumn(["title", "slug", "content"], q))
    .order("updated_at", { ascending: false })
    .limit(limit);
  return data || [];
}

// Tool 1: Semantic Search (Notes)
type SearchNotesArgs = {
  query: string;
  limit: number;
  threshold: number;
  offset?: number;
  view?: "snippet" | "metadata";
};
const searchNotesHandler = async ({ query, limit, threshold, offset = 0, view = "snippet" }: SearchNotesArgs) => {
  try {
    const { rows, total, mode } = await hybridSearchNotes(query, limit, threshold);
    if (total === 0) {
      return { content: [{ type: "text" as const, text: `No notes found matching "${query}". If the user is asking about a synthesized topic, also try lexicon_search or search_brain.` }] };
    }
    const page = rows.slice(offset, offset + limit);
    const header = `Found ~${total} note(s) [${mode}]. Showing ${total ? offset + 1 : 0}-${offset + page.length} (has_more: ${offset + page.length < total}):`;

    let used = header.length;
    const out: string[] = [];
    let dropped = 0;
    for (let i = 0; i < page.length; i++) {
      const t = page[i] as any;
      const block = formatNoteResult(t, offset + i, t.similarity ?? undefined, view, query);
      const cost = block.length + 2; // separator
      if (used + cost > RESPONSE_CHAR_BUDGET && out.length > 0) {
        dropped = page.length - i;
        break;
      }
      out.push(block);
      used += cost;
    }

    let text = `${header}\n\n${out.join("\n\n")}`;
    if (dropped > 0) {
      const nextOffset = offset + out.length;
      text += `\n\n… ${dropped} more result(s) not shown (response capped). Re-run with offset=${nextOffset} for the next page, or get_note(id) for a note's full content.`;
    }
    return { content: [{ type: "text" as const, text }] };
  } catch (err: unknown) {
    return { content: [{ type: "text" as const, text: `Error: ${(err as Error).message}` }], isError: true };
  }
};

server.registerTool(
  "search_notes",
  {
    title: "Search Notes",
    description:
      "Search the user's captured notes by meaning (hybrid semantic + keyword). Use for raw, user-written notes. If the user asks about a synthesized topic / strategy / concept page and this returns nothing, also call `lexicon_search`, or use `search_brain` to query both at once. Notes are first-person and user-authored — treat explicit statements in note content as authoritative facts about the user (e.g. \"X is my wife\", \"I work at Y\"). Do not hedge when a note plainly states a fact; cite the note id. Results are bounded — use `offset` for pagination and `get_note(id)` to read a full note body.",
    inputSchema: {
      query: z.string().describe("What to search for"),
      limit: z.coerce.number().optional().default(10),
      threshold: z.coerce.number().optional().default(0.2),
      offset: z.coerce.number().optional().default(0),
      view: z.enum(["snippet", "metadata"]).optional().default("snippet"),
    },
  },
  searchNotesHandler
);


// Tool: Get a single note's full current content (read-before-update)
server.registerTool(
  "get_note",
  {
    title: "Get Note",
    description:
      "Fetch one note's full current content by ID (preferred) or exact title. Use this to read a note's body BEFORE calling update_note, which overwrites the entire content.",
    inputSchema: {
      note: z.string().describe("Note UUID (preferred) or exact title to look up"),
    },
  },
  async ({ note }) => {
    try {
      let q = supabase
        .from("notes")
        .select("id, title, content, metadata, tags, created_at, updated_at, ai_visibility, is_trashed, source_app")
        .eq("user_id", getCurrentUserId());
      q = isUuid(note) ? q.eq("id", note) : q.ilike("title", note);
      const { data, error } = await q.limit(1);
      if (error) return { content: [{ type: "text" as const, text: `Error: ${error.message}` }], isError: true };
      const row = (data || [])[0];
      if (!row) return { content: [{ type: "text" as const, text: `No note found matching "${note}".` }] };
      if (row.ai_visibility === "hidden") {
        return { content: [{ type: "text" as const, text: "This note is hidden from AI in Menerio. Unhide it to let MCP read or edit it." }] };
      }
      const m = (row.metadata || {}) as Record<string, unknown>;
      const parts: string[] = [];
      parts.push(`Title: ${row.title || "Untitled"}`);
      parts.push(`ID: ${row.id}`);
      parts.push(`Created: ${new Date(row.created_at).toLocaleDateString()}`);
      if (row.updated_at) parts.push(`Updated: ${new Date(row.updated_at).toLocaleDateString()}`);
      parts.push(`Type: ${m.type || "unknown"}`);
      if (Array.isArray(row.tags) && row.tags.length) parts.push(`Tags: ${row.tags.join(", ")}`);
      if (row.is_trashed) parts.push("(This note is currently in the trash.)");
      parts.push(`\n${row.content || ""}`);
      return { content: [{ type: "text" as const, text: parts.join("\n") }] };
    } catch (err: unknown) {
      return { content: [{ type: "text" as const, text: `Error: ${(err as Error).message}` }], isError: true };
    }
  }
);


// Tool 2: List Recent Notes
type ListRecentArgs = {
  limit: number;
  type?: string;
  topic?: string;
  person?: string;
  days?: number;
  offset?: number;
  view?: "snippet" | "metadata";
};
const listRecentNotesHandler = async ({ limit, type, topic, person, days, offset = 0, view = "snippet" }: ListRecentArgs) => {
  try {
    let q = supabase
      .from("notes")
      .select("id, title, content, metadata, tags, created_at, updated_at", { count: "exact" })
      .eq("is_trashed", false)
      .eq("user_id", getCurrentUserId())
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1);

    if (type) q = q.contains("metadata", { type });
    if (topic) q = q.contains("metadata", { topics: [topic] });
    if (person) q = q.contains("metadata", { people: [person] });
    if (days) {
      const since = new Date();
      since.setDate(since.getDate() - days);
      q = q.gte("created_at", since.toISOString());
    }
    q = await applyVisibility(q, "notes", supabase, getCurrentUserId());

    const { data, error, count } = await q;

    if (error) {
      return { content: [{ type: "text" as const, text: `Error: ${error.message}` }], isError: true };
    }
    if (!data || !data.length) {
      return { content: [{ type: "text" as const, text: "No notes found." }] };
    }

    const total = typeof count === "number" ? count : offset + data.length;
    const header = `${total} recent note(s). Showing ${offset + 1}-${offset + data.length} (has_more: ${offset + data.length < total}):`;
    let used = header.length;
    const out: string[] = [];
    let dropped = 0;
    for (let i = 0; i < data.length; i++) {
      const t = data[i] as any;
      const block = formatNoteResult(t, offset + i, undefined, view);
      const cost = block.length + 2;
      if (used + cost > RESPONSE_CHAR_BUDGET && out.length > 0) {
        dropped = data.length - i;
        break;
      }
      out.push(block);
      used += cost;
    }
    let text = `${header}\n\n${out.join("\n\n")}`;
    if (dropped > 0) {
      const nextOffset = offset + out.length;
      text += `\n\n… ${dropped} more result(s) not shown (response capped). Re-run with offset=${nextOffset} for the next page, or get_note(id) for a note's full content.`;
    }
    return { content: [{ type: "text" as const, text }] };
  } catch (err: unknown) {
    return { content: [{ type: "text" as const, text: `Error: ${(err as Error).message}` }], isError: true };
  }
};

server.registerTool(
  "list_recent_notes",
  {
    title: "List Recent Notes",
    description:
      "List recently captured notes with optional filters by type, topic, person, or time range. Results are bounded — use `offset` for pagination and `get_note(id)` to read a full note body.",
    inputSchema: {
      limit: z.coerce.number().optional().default(10),
      type: z.string().optional().describe("Filter by type: observation, task, idea, reference, person_note, meeting_note, decision, project"),
      topic: z.string().optional().describe("Filter by topic tag"),
      person: z.string().optional().describe("Filter by person mentioned"),
      days: z.coerce.number().optional().describe("Only notes from the last N days"),
      offset: z.coerce.number().optional().default(0),
      view: z.enum(["snippet", "metadata"]).optional().default("snippet"),
    },
  },
  listRecentNotesHandler
);


// Tool 3: Capture Note
const captureNoteHandler = async ({ content }: { content: string }) => {
  try {
    const metadata = await extractMetadata(content);

    const firstLine = content.split("\n")[0];
    const title = firstLine.length > 80 ? firstLine.substring(0, 77) + "..." : firstLine;

    const { data: inserted, error } = await supabase.from("notes").insert({
      user_id: getCurrentUserId(),
      content,
      title,
      metadata: { ...metadata, source: "mcp" },
      tags: Array.isArray((metadata as any).topics) ? (metadata as any).topics : [],
    }).select("id").single();

    if (error || !inserted) {
      return { content: [{ type: "text" as const, text: `Failed to capture: ${error?.message || "insert failed"}` }], isError: true };
    }

    // Build chunks + embeddings synchronously so the note is searchable immediately.
    let indexingNote = "";
    try {
      const res = await embedAndStoreNoteChunks(
        supabase,
        OPENROUTER_API_KEY,
        getCurrentUserId(),
        inserted.id,
        title,
        content,
        "mcp-capture",
      );
      if (res.firstChunkEmbedding) {
        await supabase.from("notes").update({ embedding: res.firstChunkEmbedding }).eq("id", inserted.id);
      }
      if (res.insufficientCredits) {
        indexingNote = " (indexing deferred — insufficient credits, will catch up later)";
      } else if (res.failures > 0 && res.chunkCount === 0) {
        indexingNote = " (indexing failed — background job will retry)";
      }
    } catch (idxErr) {
      console.warn("chunk indexing failed on capture", (idxErr as Error).message);
      indexingNote = " (indexing will catch up in the background)";
    }

    // Fire-and-forget: trigger full process-note pipeline (metadata, profile facts,
    // moments, relationships, connections). Mirrors receive-note / hub-api-notes.
    try {
      fetch(`${SUPABASE_URL}/functions/v1/process-note`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ note_id: inserted.id }),
      }).catch((e) => console.warn("process-note trigger failed (capture):", (e as Error).message));
    } catch (e) {
      console.warn("process-note trigger failed (capture):", (e as Error).message);
    }



    const meta = metadata as Record<string, unknown>;
    let confirmation = `Captured as ${meta.type || "note"}`;
    if (Array.isArray(meta.topics) && meta.topics.length)
      confirmation += ` — ${(meta.topics as string[]).join(", ")}`;
    if (Array.isArray(meta.people) && meta.people.length)
      confirmation += ` | People: ${(meta.people as string[]).join(", ")}`;
    if (Array.isArray(meta.action_items) && meta.action_items.length)
      confirmation += ` | Actions: ${(meta.action_items as string[]).join("; ")}`;
    confirmation += indexingNote;

    return { content: [{ type: "text" as const, text: confirmation }] };
  } catch (err: unknown) {
    return { content: [{ type: "text" as const, text: `Error: ${(err as Error).message}` }], isError: true };
  }
};


server.registerTool(
  "capture_note",
  {
    title: "Capture Note",
    description:
      "Save a new note to the user's brain. Generates an embedding and extracts metadata automatically. Use this when the user wants to save something directly from any AI client.",
    inputSchema: {
      content: z.string().describe("The note content to capture (Markdown)"),
    },
  },
  captureNoteHandler
);

// Tool: Update Note
server.registerTool(
  "update_note",
  {
    title: "Update Note",
    description:
      "Edit an existing note's title, content (Markdown), tags, folder, favorite, or pinned state. Only fields you pass are changed. External (synced) notes cannot be edited directly — duplicate them first via the app UI.",
    inputSchema: {
      note_id: z.string().describe("The note's UUID. Get it from the `ID:` field in search_notes, list_recent_notes, get_person_notes, or get_connected_notes results."),
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
      if (!existing || existing.user_id !== getCurrentUserId()) {
        return jsonTool({ error: "Note not found" });
      }
      if (existing.is_external) {
        return jsonTool({ error: "External (synced) notes cannot be edited directly. Duplicate the note in the app first." });
      }
      try { await assertWritable(supabase, getCurrentUserId(), "note", note_id); }
      catch (e) { return jsonTool({ error: (e as Error).message }); }



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
        .eq("user_id", getCurrentUserId())
        .select("id, title, tags, folder_path, is_favorite, is_pinned, updated_at")
        .single();
      if (error) return jsonTool({ error: error.message });

      // Fire-and-forget: re-run process-note so edits re-extract metadata,
      // embeddings, profile facts, moments, and connections.
      if (content !== undefined || title !== undefined) {
        try {
          fetch(`${SUPABASE_URL}/functions/v1/process-note`, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ note_id }),
          }).catch((e) => console.warn("process-note trigger failed (update):", (e as Error).message));
        } catch (e) {
          console.warn("process-note trigger failed (update):", (e as Error).message);
        }
      }

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
      note_id: z.string().describe("The note's UUID. Get it from the `ID:` field in search_notes, list_recent_notes, get_person_notes, or get_connected_notes results."),
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
      if (!existing || existing.user_id !== getCurrentUserId()) {
        return jsonTool({ error: "Note not found" });
      }
      try { await assertWritable(supabase, getCurrentUserId(), "note", note_id); }
      catch (e) { return jsonTool({ error: (e as Error).message }); }


      const updates = restore
        ? { is_trashed: false, trashed_at: null }
        : { is_trashed: true, trashed_at: new Date().toISOString() };

      const { error } = await supabase
        .from("notes")
        .update(updates)
        .eq("id", note_id)
        .eq("user_id", getCurrentUserId());
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
    description: "Get a summary of all captured notes: totals, types, top topics, people, and recent activity.",
    inputSchema: {},
  },
  async () => {
    try {
      const { count } = await supabase
        .from("notes")
        .select("*", { count: "exact", head: true })
        .eq("is_trashed", false)
        .eq("user_id", getCurrentUserId());

      const { data } = await supabase
        .from("notes")
        .select("metadata, created_at")
        .eq("is_trashed", false)
        .eq("user_id", getCurrentUserId())
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
        `Total notes: ${count}`,
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
        .eq("user_id", getCurrentUserId())
        .order("created_at", { ascending: false });

      if (status) {
        q = q.eq("status", status);
      } else if (!include_done) {
        q = q.in("status", ["open", "in_progress"]);
      }
      if (priority) q = q.eq("priority", priority);
      q = await applyVisibility(q, "action_items", supabase, getCurrentUserId());

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
        (async () => {
          let mq = supabase
            .from("notes")
            .select("id, title, content, metadata, created_at, ai_visibility")
            .eq("is_trashed", false)
            .eq("user_id", getCurrentUserId())
            .contains("metadata", { people: [name] })
            .order("created_at", { ascending: false })
            .limit(limit);
          mq = await applyVisibility(mq, "notes", supabase, getCurrentUserId());
          return await mq;
        })(),
        (async () => {
          const emb = await getEmbedding(`notes about ${name}`);
          const { data, error } = await supabase.rpc("match_note_chunks", {
            query_embedding: emb,
            match_threshold: 0.5,
            match_count: limit * 3,
            p_user_id: getCurrentUserId(),
          });
          if (error || !data) return { data: [] as any[], error };
          const byNote = new Map<string, any>();
          for (const c of data as any[]) {
            const ex = byNote.get(c.note_id);
            if (!ex || c.similarity > ex.similarity) {
              byNote.set(c.note_id, { id: c.note_id, title: c.note_title, similarity: c.similarity });
            }
          }
          const ids = Array.from(byNote.keys()).slice(0, limit);
          if (ids.length === 0) return { data: [], error: null };
          const { data: rows } = await supabase
            .from("notes")
            .select("id, title, content, metadata, created_at, ai_visibility")
            .in("id", ids);
          const filtered = await filterVisibleNotes(rows || [], supabase, getCurrentUserId());
          return { data: filtered, error: null };
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
    description: "Search your personal CRM contacts by name, company, or relationship type. If a contact's relationship field is empty but notes about that person assert a relationship (spouse, sibling, parent, etc.), defer to the note content — the structured field is optional, not the source of truth.",
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
        .select("id, name, relationship, company, role, email, last_contact_date, contact_frequency_days, notes, is_sensitive, ai_visibility")
        .eq("user_id", getCurrentUserId())
        .is("merged_into", null)
        .order("name")
        .limit(limit);

      if (query) {
        const qq = String(query).replace(/[,()'"\\*]/g, " ").replace(/\s+/g, " ").trim();
        q = q.or(ilikeAnyColumn(["name", "company"], qq));
      }
      if (relationship) q = q.eq("relationship", relationship);
      q = await applyVisibility(q, "contacts", supabase, getCurrentUserId());

      const { data, error } = await q;
      if (error) return { content: [{ type: "text" as const, text: `Error: ${error.message}` }], isError: true };
      const redacted = redactContactList(data || []);
      if (!redacted.length) return { content: [{ type: "text" as const, text: "No contacts found." }] };

      // Pull a small allow-list of high-value profile facts per hit so the caller
      // sees birthdays / nicknames without needing a second tool call.
      const HIGHLIGHT_LABELS = new Set([
        "date of birth", "birthday", "nickname", "aliases", "ethnicity",
        "current city", "job title", "employer",
      ]);
      const visibleIds = redacted.filter((c: any) => !c._redacted).map((c: any) => c.id);
      const factsById = new Map<string, string[]>();
      if (visibleIds.length > 0) {
        const { data: pe } = await supabase
          .from("profile_entries")
          .select("contact_id, label, value")
          .eq("user_id", getCurrentUserId())
          .in("contact_id", visibleIds)
          .limit(400);
        for (const e of (pe || []) as any[]) {
          if (!HIGHLIGHT_LABELS.has(String(e.label || "").trim().toLowerCase())) continue;
          const arr = factsById.get(e.contact_id) || [];
          if (arr.length >= 4) continue;
          arr.push(`${e.label}: ${e.value}`);
          factsById.set(e.contact_id, arr);
        }
      }

      const lines = redacted.map((c: any, i: number) => {
        if (c._redacted) {
          return `${i + 1}. ${c.name}${c.relationship ? ` (${c.relationship})` : ""} — 🔒 marked sensitive, PII hidden from AI.`;
        }
        const parts = [`${i + 1}. ${c.name}`];
        if (c.relationship) parts.push(`(${c.relationship})`);
        if (c.company) parts.push(`@ ${c.company}`);
        if (c.role) parts.push(`— ${c.role}`);
        if (c.last_contact_date) {
          const days = Math.floor((Date.now() - new Date(c.last_contact_date).getTime()) / 86400000);
          parts.push(`| Last contact: ${days}d ago`);
        }
        const facts = factsById.get(c.id);
        if (facts?.length) parts.push(`\n   Profile: ${facts.join(" • ")}`);
        if (c.notes) parts.push(`\n   Notes: ${c.notes.substring(0, 200)}`);
        return parts.join(" ");
      });

      return { content: [{ type: "text" as const, text: `${redacted.length} contact(s):\n\n${lines.join("\n\n")}` }] };
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
        .eq("user_id", getCurrentUserId())
        .ilike("name", `%${name}%`)
        .is("merged_into", null)
        .eq("ai_visibility", "visible")
        .limit(1);

      if (!contacts?.length) return { content: [{ type: "text" as const, text: `No contact found matching "${name}".` }] };

      const raw = contacts[0] as any;
      const contact = redactSensitiveContact(raw) as any;

      if (contact._redacted) {
        return { content: [{ type: "text" as const, text: `# ${contact.name}\n${contact.relationship ? `Relationship: ${contact.relationship}\n` : ""}\n🔒 This person is marked sensitive in Menerio. Their PII, notes, interactions, and related Moments are hidden from AI tools. Unmark sensitive in the Person profile to grant access.` }] };
      }

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

      let notesQuery = supabase
        .from("notes")
        .select("title, content, created_at, ai_visibility, metadata")
        .eq("user_id", getCurrentUserId())
        .eq("is_trashed", false)
        .contains("metadata", { people: [contact.name] })
        .order("created_at", { ascending: false })
        .limit(5);
      notesQuery = await applyVisibility(notesQuery, "notes", supabase, getCurrentUserId());
      const { data: notes } = await notesQuery;

      if (notes?.length) {
        lines.push("", "## Related Notes");
        for (const n of notes) {
          lines.push(`- [${new Date(n.created_at).toLocaleDateString()}] ${n.title}\n  ${n.content.substring(0, 150)}`);
        }
      }

      // Structured profile facts — the whole reason external LLMs ask about a
      // person. Without this section a bot literally cannot see the birthday,
      // nicknames, favorites, etc. stored in Menerio. Cap ~40 entries; skip
      // private categories.
      const { data: catRows } = await supabase
        .from("profile_categories")
        .select("id, name, slug, sort_order")
        .eq("user_id", getCurrentUserId())
        .eq("contact_id", contact.id)
        .neq("visibility_scope", "private")
        .order("sort_order");
      const profCatIds = (catRows || []).map((c: any) => c.id);
      if (profCatIds.length > 0) {
        const { data: profEntries } = await supabase
          .from("profile_entries")
          .select("category_id, label, value, sort_order")
          .eq("user_id", getCurrentUserId())
          .eq("contact_id", contact.id)
          .in("category_id", profCatIds)
          .order("sort_order")
          .limit(60);
        if (profEntries?.length) {
          lines.push("", "## Profile");
          const byCat = new Map<string, any[]>();
          for (const e of profEntries as any[]) {
            const arr = byCat.get(e.category_id) || [];
            arr.push(e);
            byCat.set(e.category_id, arr);
          }
          let printed = 0;
          for (const cat of (catRows || []) as any[]) {
            const es = byCat.get(cat.id);
            if (!es?.length) continue;
            lines.push(`### ${cat.name}`);
            for (const e of es) {
              if (printed >= 40) break;
              lines.push(`- ${e.label}: ${e.value}`);
              printed++;
            }
            if (printed >= 40) { lines.push(`(profile truncated at 40 entries)`); break; }
          }
        }
      }

      return { content: [{ type: "text" as const, text: lines.join("\n") }] };
    } catch (err: unknown) {
      return { content: [{ type: "text" as const, text: `Error: ${(err as Error).message}` }], isError: true };
    }
  }
);


// Tool: Get Contact Profile — return a contact's structured profile_entries.
// Mirror of get_user_profile but for a named contact. This is the direct
// "look up X's birthday / nickname / favorite food" tool.
server.registerTool(
  "get_contact_profile",
  {
    title: "Get Contact Profile",
    description:
      "Return a specific contact's structured profile facts (birthday, nicknames, favorite foods, aliases, ethnicity, location, job, …). Use this when the user asks about a specific person's attributes and `get_contact_context` doesn't include enough profile detail. Provide either `name` (fuzzy) or `contact_id`.",
    inputSchema: {
      name: z.string().optional().describe("Contact name (fuzzy, case-insensitive)"),
      contact_id: z.string().uuid().optional().describe("Exact contact UUID"),
    },
  },
  async ({ name, contact_id }) => {
    try {
      if (!name && !contact_id) {
        return { content: [{ type: "text" as const, text: "Provide either `name` or `contact_id`." }], isError: true };
      }
      let cq = supabase
        .from("contacts")
        .select("id, name, is_sensitive, ai_visibility")
        .eq("user_id", getCurrentUserId())
        .is("merged_into", null)
        .eq("ai_visibility", "visible")
        .limit(1);
      cq = contact_id ? cq.eq("id", contact_id) : cq.ilike("name", `%${name}%`);
      const { data: cs } = await cq;
      if (!cs?.length) return { content: [{ type: "text" as const, text: `No contact found.` }] };
      const c = cs[0] as any;
      if (c.is_sensitive) {
        return { content: [{ type: "text" as const, text: `# ${c.name}\n🔒 Marked sensitive — profile facts hidden from AI.` }] };
      }
      const { data: cats } = await supabase
        .from("profile_categories")
        .select("id, name, slug, sort_order")
        .eq("user_id", getCurrentUserId())
        .eq("contact_id", c.id)
        .neq("visibility_scope", "private")
        .order("sort_order");
      const ids = (cats || []).map((x: any) => x.id);
      if (ids.length === 0) {
        return { content: [{ type: "text" as const, text: `# ${c.name}\nNo structured profile facts recorded yet.` }] };
      }
      const { data: entries } = await supabase
        .from("profile_entries")
        .select("category_id, label, value, sort_order")
        .eq("user_id", getCurrentUserId())
        .eq("contact_id", c.id)
        .in("category_id", ids)
        .order("sort_order");
      const byCat = new Map<string, any[]>();
      for (const e of (entries || []) as any[]) {
        const arr = byCat.get(e.category_id) || [];
        arr.push(e);
        byCat.set(e.category_id, arr);
      }
      const out: string[] = [`# ${c.name} — Profile`];
      for (const cat of (cats || []) as any[]) {
        const es = byCat.get(cat.id);
        if (!es?.length) continue;
        out.push(`\n## ${cat.name}`);
        for (const e of es) out.push(`- ${e.label}: ${e.value}`);
      }
      if (out.length === 1) out.push("No entries.");
      return { content: [{ type: "text" as const, text: out.join("\n") }] };
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
    let q = supabase.from("contacts").select("id, name, relationship, is_sensitive, ai_visibility, created_at").eq("user_id", getCurrentUserId()).is("merged_into", null).order("name").limit(limit);
    q = await applyVisibility(q, "contacts", supabase, getCurrentUserId());
    const { data, error } = await q;
    if (error) return jsonTool({ error: error.message });
    return jsonTool(redactContactList(data || []));
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
    let q = supabase.from("moments").select("id, moment_uid, title, description, happened_at, happened_end, category, status, impact_level, confidence_date, confidence_truth, source, person_id, created_at, updated_at").eq("user_id", getCurrentUserId()).is("deleted_at", null).order("happened_at", { ascending: false }).limit(limit);
    if (person_name) {
      const { data: matches } = await supabase.from("contacts").select("id").eq("user_id", getCurrentUserId()).ilike("name", `%${person_name}%`).is("merged_into", null);
      if (!matches?.length) return jsonTool({ message: "No people matching that name." });
      q = q.in("person_id", matches.map((p: any) => p.id));
    }
    q = await applyVisibility(q, "moments", supabase, getCurrentUserId());
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
    // The filter grammar's delimiters used to be stripped to spaces here, which
    // kept the request valid at the cost of silently changing the search: a
    // query for "Q1 (draft)" actually searched for "Q1 draft". ilikeAnyColumn
    // quotes them instead, so the term is matched as typed.
    let q = supabase.from("moments").select("id, moment_uid, title, description, happened_at, happened_end, category, status, impact_level, confidence_date, confidence_truth, source, person_id, created_at, updated_at").eq("user_id", getCurrentUserId()).is("deleted_at", null).or(ilikeAnyColumn(["title", "description"], query)).order("happened_at", { ascending: false }).limit(limit);
    q = await applyVisibility(q, "moments", supabase, getCurrentUserId());
    const { data, error } = await q;
    if (error) return jsonTool({ error: error.message });
    return jsonTool({ fields: MOMENT_RESPONSE_FIELDS, moments: data });
  }
);


async function createMomentWithLinks(input: any, source: "mcp" | "mcp_ai") {
  const participantNames = uniqueStrings([input.person_name, ...(input.participant_names ?? [])]);
  const contacts = await resolveOrCreateContactsByName(participantNames);
  const primary = input.person_name ? contacts.find((c) => c.name.toLowerCase() === String(input.person_name).toLowerCase()) : contacts[0];
  const payload = {
    user_id: getCurrentUserId(),
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
  // Non-person things the moment happened at/with (places, orgs, projects, pets…).
  const entities = await resolveOrCreateEntitiesByName(input.entity_names ?? []);
  if (entities.length) {
    const { error: entityError } = await supabase
      .from("moment_entities")
      .insert(entities.map((e) => ({ moment_id: moment.id, entity_id: e.id, user_id: getCurrentUserId() })));
    if (entityError) throw new Error(entityError.message);
  }
  return { ...moment, primary_person: primary || null, participants: contacts, entities, documents: [], field_parity: { available_moment_fields: MOMENT_FIELD_NAMES, response_fields: MOMENT_RESPONSE_FIELDS } };
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
  entity_names: z.array(z.string()).optional().describe("Non-person things involved: places, organizations, projects, pets. Created in World if unknown."),
};

async function draftMomentFromDescription(description: string, params: any) {
  const { data: contacts } = await supabase.from("contacts").select("name").eq("user_id", getCurrentUserId()).is("merged_into", null).order("name");
  const peopleContext = contacts?.length ? `\n\nKnown people in the user's timeline: ${contacts.map((p: any) => p.name).join(", ")}` : "";
  const hints = [params.happened_at && `Date hint: ${params.happened_at}`, params.title_hint && `Title hint: ${params.title_hint}`, params.category_hint && `Category hint: ${params.category_hint}`, params.status_hint && `Status hint: ${params.status_hint}`, params.person_name && `Primary person hint: ${params.person_name}`, params.participant_names?.length && `Participant hints: ${params.participant_names.join(", ")}`].filter(Boolean).join("\n");
  const content = hints ? `${description}\n\nUse these caller-provided hints where appropriate:\n${hints}` : description;
  const { result, credits } = await openRouterWithCredits(supabase, OPENROUTER_API_KEY, getCurrentUserId(), "mcp-create-moment", "chat/completions", {
    model: "google/gemini-3-flash-preview",
    messages: [{ role: "system", content: `Extract a structured Menerio timeline Moment. Return only via the draft_moment tool. Today's date: ${new Date().toISOString().slice(0, 10)}${peopleContext}` }, { role: "user", content }],
    tools: [{ type: "function", function: { name: "draft_moment", description: "Return a structured timeline moment draft.", parameters: { type: "object", properties: { happened_at: { type: "string" }, happened_end: { type: "string" }, title: { type: "string" }, status: { type: "string", enum: ALLOWED_MOMENT_STATUSES }, impact_level: { type: "integer", minimum: 1, maximum: 4 }, confidence_date: { type: "integer", minimum: 0, maximum: 10 }, confidence_truth: { type: "integer", minimum: 0, maximum: 10 }, participants: { type: "array", items: { type: "string" } } }, required: ["happened_at", "title", "status", "impact_level", "confidence_date", "confidence_truth"], additionalProperties: false } } }],
    tool_choice: { type: "function", function: { name: "draft_moment" } },
  });
  const toolCall = result.choices?.[0]?.message?.tool_calls?.[0];
  if (!toolCall) throw new Error("AI draft did not produce a moment");
  return { draft: JSON.parse(toolCall.function.arguments), credits };
}

server.registerTool("create_moment_with_ai", { title: "Create Moment with AI", description: "Preferred default. Create a Moment from a natural-language description; AI fills in the structured fields and saves it automatically.", inputSchema: { description: z.string(), happened_at: z.string().optional(), person_name: z.string().optional(), participant_names: z.array(z.string()).optional(), title_hint: z.string().optional(), category_hint: z.string().optional(), status_hint: z.enum(ALLOWED_MOMENT_STATUSES).optional(), impact_level_hint: z.number().optional(), confidence_date_hint: z.number().optional(), confidence_truth_hint: z.number().optional(), document_ids: z.array(z.string()).optional(), entity_names: z.array(z.string()).optional() } }, async (params) => {
  try {
    const { draft, credits } = await draftMomentFromDescription(params.description, params);
    const names = uniqueStrings([params.person_name, ...(params.participant_names ?? []), ...(draft.participants ?? [])]);
    const moment = await createMomentWithLinks({ ...draft, description: params.description, title: params.title_hint ?? draft.title, happened_at: params.happened_at ?? draft.happened_at, category: params.category_hint ?? draft.category, status: params.status_hint ?? draft.status, impact_level: params.impact_level_hint ?? draft.impact_level, confidence_date: params.confidence_date_hint ?? draft.confidence_date, confidence_truth: params.confidence_truth_hint ?? draft.confidence_truth, person_name: params.person_name ?? names[0], participant_names: names, document_ids: params.document_ids ?? [], entity_names: params.entity_names ?? [] }, "mcp_ai");
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
          .eq("user_id", getCurrentUserId())
          .ilike("title", `%${note}%`)
          .limit(1);
        if (!data?.length) return { content: [{ type: "text" as const, text: `No note found matching "${note}".` }] };
        noteId = data[0].id;
      }

      const { data: connections } = await supabase
        .from("note_connections")
        .select("*")
        .eq("user_id", getCurrentUserId())
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
          .eq("user_id", getCurrentUserId())
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
        .eq("user_id", getCurrentUserId());

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
        .eq("user_id", getCurrentUserId());

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
        .eq("user_id", getCurrentUserId())
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
        user_id: getCurrentUserId(),
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
      limit: z.coerce.number().optional().default(10),
      threshold: z.coerce.number().optional().default(0.5),
      offset: z.coerce.number().optional().default(0),
      view: z.enum(["snippet", "metadata"]).optional().default("snippet"),
    },
  },
  async ({ query, limit, threshold, offset = 0, view = "snippet" }) => {
    try {
      const qEmb = await getEmbedding(query);
      const { data, error } = await supabase.rpc("match_media", {
        query_embedding: qEmb,
        match_threshold: threshold,
        match_count: CANDIDATE_CAP,
        p_user_id: getCurrentUserId(),
      });

      if (error) {
        return { content: [{ type: "text" as const, text: `Search error: ${error.message}` }], isError: true };
      }

      if (!data || data.length === 0) {
        return { content: [{ type: "text" as const, text: `No images or PDFs found matching "${query}".` }] };
      }

      const total = data.length;
      const page = data.slice(offset, offset + limit);
      const clamp = (s: string) => {
        const norm = s.replace(/\s+/g, " ").trim();
        return norm.length > SNIPPET_CAP ? norm.slice(0, SNIPPET_CAP - 1) + "…" : norm;
      };

      const header = `Found ~${total} media match(es). Showing ${total ? offset + 1 : 0}-${offset + page.length} (has_more: ${offset + page.length < total}):`;

      let used = header.length;
      const blocks: string[] = [];
      let dropped = 0;
      for (let i = 0; i < page.length; i++) {
        const m = page[i] as any;
        const parts: string[] = [];
        parts.push(`--- Result ${offset + i + 1} (${(m.similarity * 100).toFixed(1)}% match) ---`);
        const label = m.media_type === "pdf" || m.media_type === "pdf_page"
          ? `PDF${m.page_number ? ` page ${m.page_number}` : ""}`
          : "Image";
        parts.push(`Type: ${label}`);
        if (m.original_filename) parts.push(`File: ${m.original_filename}`);
        if (m.note_title) parts.push(`Note: ${m.note_title}`);
        if (view !== "metadata") {
          if (m.description) parts.push(`Description: ${clamp(String(m.description))}`);
          if (m.extracted_text) parts.push(`Text: ${clamp(String(m.extracted_text))}`);
        }
        const block = parts.join("\n");
        const cost = block.length + 2;
        if (used + cost > RESPONSE_CHAR_BUDGET && blocks.length > 0) {
          dropped = page.length - i;
          break;
        }
        blocks.push(block);
        used += cost;
      }

      let text = `${header}\n\n${blocks.join("\n\n")}`;
      if (dropped > 0) {
        const nextOffset = offset + blocks.length;
        text += `\n\n… ${dropped} more result(s) not shown (response capped). Re-run with offset=${nextOffset} for the next page, or get_note_media(note) for a note's full media.`;
      }
      return { content: [{ type: "text" as const, text }] };
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
          .eq("user_id", getCurrentUserId())
          .ilike("title", `%${note}%`)
          .limit(1);
        if (!data?.length) return { content: [{ type: "text" as const, text: `No note found matching "${note}".` }] };
        noteId = data[0].id;
      }

      const { data: media, error } = await supabase
        .from("media_analysis")
        .select("storage_path, media_type, page_number, original_filename, description, extracted_text, topics, analysis_status, raw_analysis")
        .eq("note_id", noteId)
        .eq("user_id", getCurrentUserId())
        .order("created_at", { ascending: true });

      if (error) return { content: [{ type: "text" as const, text: `Error: ${error.message}` }], isError: true };
      if (!media?.length) return { content: [{ type: "text" as const, text: "No media found in this note." }] };

      const header = `${media.length} media item(s) in this note:`;
      let used = header.length;
      const lines: string[] = [];
      let dropped = 0;
      for (let i = 0; i < media.length; i++) {
        const m = media[i] as any;
        const parts: string[] = [];
        const label = m.media_type === "pdf" || m.media_type === "pdf_page"
          ? `PDF${m.page_number ? ` page ${m.page_number}` : ""}`
          : "Image";
        parts.push(`${i + 1}. [${label}] ${m.original_filename || m.storage_path.split("/").pop()}`);
        parts.push(`   Status: ${m.analysis_status}`);
        if (m.description) {
          const desc = String(m.description).replace(/\s+/g, " ").trim();
          const clamped = desc.length > SNIPPET_CAP ? desc.slice(0, SNIPPET_CAP - 1) + "…" : desc;
          parts.push(`   Description: ${clamped}`);
        }
        if (m.topics?.length) parts.push(`   Topics: ${m.topics.join(", ")}`);
        if (m.extracted_text) parts.push(`   Text: ${m.extracted_text.substring(0, 300)}${m.extracted_text.length > 300 ? "…" : ""}`);
        const raw = m.raw_analysis as Record<string, unknown> | null;
        if (raw?.content_type) parts.push(`   Content type: ${raw.content_type}`);
        const block = parts.join("\n");
        const cost = block.length + 2;
        if (used + cost > RESPONSE_CHAR_BUDGET && lines.length > 0) {
          dropped = media.length - i;
          break;
        }
        lines.push(block);
        used += cost;
      }

      let text = `${header}\n\n${lines.join("\n\n")}`;
      if (dropped > 0) {
        text += `\n\n… ${dropped} more media item(s) not shown (response capped).`;
      }
      return { content: [{ type: "text" as const, text }] };
    } catch (err: unknown) {
      return { content: [{ type: "text" as const, text: `Error: ${(err as Error).message}` }], isError: true };
    }
  }
);

// Derive relationships for the current user from two sources:
//   1. Structured: contacts.relationship (when populated by the user).
//   2. Derived: first-person assertions in note content like
//      "X is my wife", "my wife [[X]]", "wife: X". Wikilink-aware.
// Returns a compact, agent-friendly shape suitable for embedding in
// get_user_profile responses so personal-fact questions are answered
// in a single tool call.
async function deriveUserRelationships(userId: string): Promise<{
  structured: Array<{ name: string; relationship: string; contact_id: string }>;
  derived: Array<{ name: string; relationship: string; source_note_id: string; source_note_title: string; quote: string }>;
} | null> {
  try {
    // 1a) Structured contacts with a scalar relationship value.
    const { data: contactRows } = await supabase
      .from("contacts")
      .select("id, name, relationship, ai_visibility, is_sensitive")
      .eq("user_id", userId)
      .is("merged_into", null);

    const visibleContactsById = new Map<string, { id: string; name: string; ai_visibility: string | null; is_sensitive: boolean | null }>();
    for (const c of (contactRows || []) as any[]) {
      if (c.ai_visibility === "hidden" || c.is_sensitive) continue;
      if (!c.name) continue;
      visibleContactsById.set(c.id, c);
    }

    const structured: Array<{ name: string; relationship: string; contact_id: string }> = [];
    const structuredSeen = new Set<string>(); // name|rel (case-insensitive)
    const pushStructured = (name: string, rel: string, contactId: string) => {
      const normRel = rel.toLowerCase().trim();
      const key = `${name.toLowerCase().trim()}|${normRel}`;
      if (structuredSeen.has(key)) return;
      const junk = new Set(["self", "myself", "me", "none", "n/a", "na", "unknown"]);
      if (junk.has(normRel)) return;
      structuredSeen.add(key);
      structured.push({ name, relationship: normRel, contact_id: contactId });
    };

    for (const c of (contactRows || []) as any[]) {
      if (!visibleContactsById.has(c.id)) continue;
      if (!c.relationship) continue;
      pushStructured(c.name, String(c.relationship), c.id);
    }

    // 1b) Typed multi-valued relationships from contact_relationships
    //     where the contact is the source and the user ('self') is the target.
    const { data: relRows } = await supabase
      .from("contact_relationships")
      .select("source_id, source_type, target_type, label, custom_label")
      .eq("user_id", userId)
      .eq("target_type", "self")
      .eq("source_type", "contact")
      .not("source_id", "is", null);

    for (const r of (relRows || []) as any[]) {
      const contact = visibleContactsById.get(r.source_id);
      if (!contact) continue;
      const label = String(r.custom_label || r.label || "").trim();
      if (!label) continue;
      pushStructured(contact.name, label, contact.id);
    }

    // 2) Derived: scan visible, non-trashed notes for first-person relationship
    //    assertions. Keep it bounded — most recent 500 notes.
    const { data: notes } = await supabase
      .from("notes")
      .select("id, title, content, ai_visibility, is_trashed")
      .eq("user_id", userId)
      .eq("is_trashed", false)
      .order("updated_at", { ascending: false })
      .limit(500);

    const derived: Array<{ name: string; relationship: string; source_note_id: string; source_note_title: string; quote: string }> = [];
    const seen = new Set<string>(); // dedupe by name|relationship
    const relAlt = RELATIONSHIP_TERMS.map(escapeRegex).join("|");

    // Patterns we recognise:
    //   "[[Name]] is my <rel>"      → name = wikilink target or display
    //   "<Name> is my <rel>"        → name = preceding capitalised words / note title
    //   "my <rel> [[Name]]"
    //   "my <rel>, [[Name]]"
    const patterns: Array<{ re: RegExp; nameGroup: number; relGroup: number }> = [
      { re: new RegExp(`\\[\\[([^\\]|]+)(?:\\|[^\\]]*)?\\]\\]\\s+is\\s+my\\s+(${relAlt})\\b`, "gi"), nameGroup: 1, relGroup: 2 },
      { re: new RegExp(`\\bmy\\s+(${relAlt})[\\s,:\\-—]+\\[\\[([^\\]|]+)(?:\\|[^\\]]*)?\\]\\]`, "gi"), nameGroup: 2, relGroup: 1 },
    ];

    for (const n of (notes || []) as any[]) {
      if (n.ai_visibility === "hidden") continue;
      const content = String(n.content || "");
      if (!content) continue;

      // Plus: "<NoteTitle> is my <rel>" anywhere in the body — useful for
      // person-notes where the note title is the person's name.
      const titleEsc = n.title ? escapeRegex(String(n.title)) : null;
      const titleRe = titleEsc
        ? new RegExp(`\\b${titleEsc}\\b\\s+is\\s+my\\s+(${relAlt})\\b`, "i")
        : null;
      if (titleRe) {
        const m = titleRe.exec(content);
        if (m) {
          const key = `${n.title.toLowerCase()}|${m[1].toLowerCase()}`;
          if (!seen.has(key)) {
            seen.add(key);
            derived.push({
              name: n.title,
              relationship: m[1].toLowerCase(),
              source_note_id: n.id,
              source_note_title: n.title,
              quote: buildWindowSnippet(content, m.index, m[0].length, 80),
            });
          }
        }
      }

      for (const { re, nameGroup, relGroup } of patterns) {
        re.lastIndex = 0;
        let m: RegExpExecArray | null;
        while ((m = re.exec(content)) !== null) {
          const name = (m[nameGroup] || "").trim();
          const rel = (m[relGroup] || "").trim().toLowerCase();
          if (!name || !rel) continue;
          const key = `${name.toLowerCase()}|${rel}`;
          if (seen.has(key)) continue;
          seen.add(key);
          derived.push({
            name,
            relationship: rel,
            source_note_id: n.id,
            source_note_title: n.title || "",
            quote: buildWindowSnippet(content, m.index, m[0].length, 80),
          });
        }
      }
    }

    if (structured.length === 0 && derived.length === 0) return null;
    return { structured, derived };
  } catch (err) {
    console.warn("deriveUserRelationships failed:", err);
    return null;
  }
}


server.registerTool(
  "get_user_profile",
  {
    title: "Get User Profile",
    description:
      "Retrieve the user's personal profile — identity, preferences, values, goals, health info, and explicit instructions for how to interact with them. The response also includes a `relationships` block listing key people in the user's life (spouse, partner, family, etc.), derived from structured contact fields AND from first-person assertions in notes (e.g. \"X is my wife\"). Use this at the start of conversations and whenever the user asks about people close to them — the answer is usually here in one call.",
    inputSchema: {
      scope: z.string().optional().describe("Filter by scope: all, professional, personal, health. Omit to get everything except private."),
      categories: z.array(z.string()).optional().describe("Only return these category slugs"),
      include_notes: z.boolean().optional().default(false).describe("Include linked note content"),
      include_instructions: z.boolean().optional().default(true).describe("Include agent instructions"),
    },
  },
  async ({ scope, categories: catSlugs, include_notes, include_instructions }) => {
    try {
      // Always compute derived relationships — they're the single most useful
      // self-knowledge surface and must show up even when the user hasn't yet
      // populated a profile category.
      const relationships = await deriveUserRelationships(getCurrentUserId());

      const emptyProfileResponse = () => {
        const payload: Record<string, unknown> = {
          profile: {
            categories: [],
            note: "No profile categories defined yet. The user can create their profile in Menerio's Profile section.",
          },
        };
        if (relationships) payload.relationships = relationships;
        return { content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }] };
      };

      // Fetch categories (never return private via MCP).
      // contact_id IS NULL → user's own profile categories (not contacts').
      let catQuery = supabase
        .from("profile_categories")
        .select("id, name, slug, visibility_scope, sort_order")
        .eq("user_id", getCurrentUserId())
        .is("contact_id", null)
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

      // Fetch entries for these categories — also restricted to the user's own
      // profile (contact_id IS NULL) so contact entries never leak through.
      const catIds = filteredCats.map((c: any) => c.id);
      if (catIds.length === 0) {
        return emptyProfileResponse();
      }

      const { data: entries } = await supabase
        .from("profile_entries")
        .select("category_id, label, value, linked_note_id, sort_order")
        .eq("user_id", getCurrentUserId())
        .is("contact_id", null)
        .in("category_id", catIds)
        .order("sort_order");

      // Check if there are any entries at all
      if (!entries?.length) {
        return emptyProfileResponse();
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

      // Build structured response, collapsing categories that share a slug into
      // one block and de-duplicating entries within each block by (label, value).
      const slugOrder: string[] = [];
      const slugBuckets = new Map<string, { name: string; slug: string; catIds: string[] }>();
      for (const cat of filteredCats as any[]) {
        const slug = cat.slug || cat.id;
        if (!slugBuckets.has(slug)) {
          slugBuckets.set(slug, { name: cat.name, slug, catIds: [cat.id] });
          slugOrder.push(slug);
        } else {
          slugBuckets.get(slug)!.catIds.push(cat.id);
        }
      }

      const profileCategories = slugOrder.map((slug) => {
        const bucket = slugBuckets.get(slug)!;
        const catIdSet = new Set(bucket.catIds);
        const seenEntries = new Map<string, Record<string, unknown>>();
        const orderedKeys: string[] = [];

        for (const e of (entries || []) as any[]) {
          if (!catIdSet.has(e.category_id)) continue;
          const labelKey = String(e.label ?? "").trim().toLowerCase();
          const valueKey = String(e.value ?? "").trim().toLowerCase();
          const key = `${labelKey}\u0000${valueKey}`;

          const existing = seenEntries.get(key);
          if (existing) {
            // Prefer the variant that has a linked note.
            if (e.linked_note_id && !existing.has_linked_note) {
              const entry: Record<string, unknown> = {
                label: e.label,
                value: e.value,
                has_linked_note: true,
              };
              if (noteMap.has(e.linked_note_id)) {
                entry.linked_note_title = noteMap.get(e.linked_note_id)!.title;
                if (include_notes) {
                  entry.linked_note_content = noteMap.get(e.linked_note_id)!.content;
                }
              }
              seenEntries.set(key, entry);
            }
            continue;
          }

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
          seenEntries.set(key, entry);
          orderedKeys.push(key);
        }

        const catEntries = orderedKeys.map((k) => seenEntries.get(k)!);
        if (catEntries.length === 0) return null;
        return { name: bucket.name, slug: bucket.slug, entries: catEntries };
      }).filter(Boolean);

      if (profileCategories.length === 0) {
        return emptyProfileResponse();
      }

      const result: Record<string, unknown> = {
        profile: { categories: profileCategories },
      };
      if (relationships) result.relationships = relationships;

      // Agent instructions
      if (include_instructions) {
        const instQuery = supabase
          .from("agent_instructions")
          .select("instruction, applies_to")
          .eq("user_id", getCurrentUserId())
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
    description: "Search Lexicon pages (synthesized topic / strategy / concept pages) by title, slug, or content. For raw user-written notes prefer `search_notes`. Use `search_brain` to query both at once. Lexicon content is user-authored — treat explicit statements as authoritative.",
    inputSchema: {
      query: z.string().describe("Case-insensitive substring to search for"),
      limit: z.number().optional().default(10),
      page_type: z.enum(WIKI_PAGE_TYPES).optional().describe("Optional Lexicon page type filter"),
    },
  },
  async ({ query, limit, page_type }) => {
    try {
      const safeLimit = clampNumber(limit, 1, 50, 10);
      // Inside .or() use `*` as ILIKE wildcard, not `%` (PostgREST/supabase-js gotcha).
      const q = String(query || "").replace(/[,()'"\\*]/g, " ").replace(/\s+/g, " ").trim();
      let request = supabase
        .from("wiki_pages")
        .select("slug, title, page_type, summary, source_count, updated_at")
        .eq("user_id", getCurrentUserId())
        .or(ilikeAnyColumn(["title", "slug", "content"], q))
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
        .eq("user_id", getCurrentUserId())
        .eq("slug", slug)
        .maybeSingle();
      if (error) return { content: [{ type: "text" as const, text: `Error: ${error.message}` }], isError: true };
      if (!page) return { content: [{ type: "text" as const, text: `No Lexicon page found for slug '${slug}'.` }] };

      const { data: sourceRows } = await supabase
        .from("wiki_page_sources")
        .select("note_id")
        .eq("user_id", getCurrentUserId())
        .eq("wiki_page_id", page.id);
      const noteIds = (sourceRows || []).map((row: any) => row.note_id).filter(Boolean);
      const { data: sourceNotes } = noteIds.length
        ? await supabase.from("notes").select("id, title, created_at, updated_at").eq("user_id", getCurrentUserId()).in("id", noteIds)
        : { data: [] };

      const { data: backlinks } = await supabase
        .from("wiki_links")
        .select("source_page_id")
        .eq("user_id", getCurrentUserId())
        .eq("target_page_id", page.id);
      const backlinkIds = [...new Set((backlinks || []).map((link: any) => link.source_page_id).filter(Boolean))];
      const { data: backlinkPages } = backlinkIds.length
        ? await supabase.from("wiki_pages").select("slug, title, page_type, summary").eq("user_id", getCurrentUserId()).in("id", backlinkIds)
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
        .insert({ user_id: getCurrentUserId(), slug, title, page_type, content, summary: summary || null })
        .select("id, slug, title, page_type, summary, content, created_at, updated_at")
        .single();
      if (error) return { content: [{ type: "text" as const, text: `Error: ${error.message}` }], isError: true };

      const { error: revisionError } = await supabase.from("wiki_revisions").insert({
        user_id: getCurrentUserId(),
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
        .eq("user_id", getCurrentUserId())
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
        .eq("user_id", getCurrentUserId())
        .eq("id", existing.id)
        .select("id, slug, title, page_type, summary, content, updated_at")
        .single();
      if (updateError) return { content: [{ type: "text" as const, text: `Error: ${updateError.message}` }], isError: true };

      const { error: revisionError } = await supabase.from("wiki_revisions").insert({
        user_id: getCurrentUserId(),
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
          "x-menerio-user-id": getCurrentUserId(),
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
    const { data: groups, error } = await supabase.from("contact_groups").select("id, name, slug, type, purpose, template, color, icon, stages, success_criteria, updated_at").eq("user_id", getCurrentUserId()).eq("is_trashed", false).order("updated_at", { ascending: false }).limit(safeLimit);
    if (error) return { content: [{ type: "text" as const, text: `Error: ${error.message}` }], isError: true };
    const ids = (groups || []).map((group: any) => group.id);
    const { data: memberships } = ids.length ? await supabase.from("contact_group_memberships").select("group_id").eq("user_id", getCurrentUserId()).in("group_id", ids).is("archived_at", null) : { data: [] };
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
      supabase.from("contact_group_memberships").select("*, contacts:contact_id(id, name, company, role, email, tags)").eq("user_id", getCurrentUserId()).eq("group_id", group.id).is("archived_at", null).order("position"),
      supabase.from("contact_interactions").select("id, interaction_date, type, summary, note_id, contact_id, action_items").eq("user_id", getCurrentUserId()).eq("group_id", group.id).order("interaction_date", { ascending: false }).limit(10),
      supabase.from("action_items").select("id, content, status, priority, due_date, contact_id, metadata").eq("user_id", getCurrentUserId()).eq("status", "open").eq("metadata->>group_id", group.id).order("created_at", { ascending: false }).limit(20),
      supabase.from("group_briefings").select("briefing_markdown, generated_at, period_days").eq("user_id", getCurrentUserId()).eq("group_id", group.id).order("generated_at", { ascending: false }).limit(1),
    ]);
    let notes: any[] = [];
    if (include_notes) {
      const names = (memberships || []).map((m: any) => m.contacts?.name).filter(Boolean).slice(0, 20);
      const { data } = names.length ? await supabase.from("notes").select("id, title, content, created_at, metadata").eq("user_id", getCurrentUserId()).eq("is_trashed", false).contains("metadata", { people: names }).order("created_at", { ascending: false }).limit(10) : { data: [] };
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
      const { data } = await supabase.from("contact_groups").select("id").eq("user_id", getCurrentUserId()).eq("slug", slug).maybeSingle();
      if (!data) break;
      slug = `${baseSlug}-${i}`;
    }
    const { data: group, error } = await supabase.from("contact_groups").insert({ user_id: getCurrentUserId(), name: name.trim(), slug, purpose: purpose || null, description: description || null, type: type || "other", template: template || null, stages: stages || [], success_criteria: success_criteria || [], color: color || null, icon: icon || null }).select("*").single();
    if (error) return { content: [{ type: "text" as const, text: `Error: ${error.message}` }], isError: true };
    await supabase.from("wiki_pages").insert({ user_id: getCurrentUserId(), slug: `group-${group.slug}`, page_type: "group", title: group.name, summary: group.purpose, metadata: { group_id: group.id }, content: `# ${group.name}\n\n## Purpose\n${group.purpose || ""}\n\n## Members\n_Synced automatically from contact_group_memberships._\n\n## Insights\n_Synthesized from notes mentioning members._\n` });
    return jsonTool({ ok: true, group });
  } catch (err: unknown) {
    return { content: [{ type: "text" as const, text: `Error: ${(err as Error).message}` }], isError: true };
  }
});

server.registerTool("add_group_member", { title: "Add Group Member", description: "Add a person to a Group, or restore the active membership if it already exists.", inputSchema: { group_id_or_slug: z.string(), contact_id: z.string().optional(), contact_name: z.string().optional(), status: z.string().optional(), priority: z.string().optional().default("normal"), reason: z.string().optional(), notes: z.string().optional() } }, async ({ group_id_or_slug, contact_id, contact_name, status, priority, reason, notes }) => {
  try {
    const group = await resolveGroup(group_id_or_slug);
    const contact = await resolveContact({ contact_id, contact_name });
    const { data: existing } = await supabase.from("contact_group_memberships").select("*").eq("user_id", getCurrentUserId()).eq("group_id", group.id).eq("contact_id", contact.id).is("archived_at", null).maybeSingle();
    if (existing) return jsonTool({ ok: true, changed: false, membership: existing });
    const { data, error } = await supabase.from("contact_group_memberships").insert({ user_id: getCurrentUserId(), group_id: group.id, contact_id: contact.id, status: status || null, priority: priority || "normal", reason: reason || null, notes: notes || null }).select("*").single();
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
    const { data, error } = await supabase.from("contact_group_memberships").update(updates).eq("user_id", getCurrentUserId()).eq("id", membership_id).select("*").single();
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
    const { data, error } = await supabase.from("contact_interactions").insert({ user_id: getCurrentUserId(), group_id: group.id, contact_id: contact.id, type, summary: summary || null, action_items: action_items || [], note_id: note_id || null, interaction_date: date }).select("*").single();
    if (error) return { content: [{ type: "text" as const, text: `Error: ${error.message}` }], isError: true };
    await supabase.from("contacts").update({ last_contact_date: date }).eq("user_id", getCurrentUserId()).eq("id", contact.id);
    return jsonTool({ ok: true, interaction: data, group: { id: group.id, name: group.name }, person: { id: contact.id, name: contact.name } });
  } catch (err: unknown) {
    return { content: [{ type: "text" as const, text: `Error: ${(err as Error).message}` }], isError: true };
  }
});

server.registerTool("create_group_next_step", { title: "Create Group Next Step", description: "Create an open next-step action for a Group membership.", inputSchema: { membership_id: z.string(), content: z.string(), priority: z.string().optional().default("normal"), due_date: z.string().optional() } }, async ({ membership_id, content, priority, due_date }) => {
  try {
    const { data: membership, error: membershipError } = await supabase.from("contact_group_memberships").select("id, group_id, contact_id").eq("user_id", getCurrentUserId()).eq("id", membership_id).maybeSingle();
    if (membershipError) throw new Error(membershipError.message);
    if (!membership) throw new Error("Membership not found");
    const { data, error } = await supabase.from("action_items").insert({ user_id: getCurrentUserId(), contact_id: (membership as any).contact_id, content, priority: priority || "normal", due_date: due_date || null, status: "open", metadata: { group_membership_id: membership_id, group_id: (membership as any).group_id, contact_id: (membership as any).contact_id } }).select("*").single();
    if (error) return { content: [{ type: "text" as const, text: `Error: ${error.message}` }], isError: true };
    return jsonTool({ ok: true, action_item: data });
  } catch (err: unknown) {
    return { content: [{ type: "text" as const, text: `Error: ${(err as Error).message}` }], isError: true };
  }
});

server.registerTool("suggest_group_next_step", { title: "Suggest Group Next Step", description: "Use AI to suggest one concrete next step for a Group membership without saving it.", inputSchema: { membership_id: z.string() } }, async ({ membership_id }) => {
  try {
    const { data: membership, error: membershipError } = await supabase.from("contact_group_memberships").select("*, contact_groups:group_id(*), contacts:contact_id(*)").eq("id", membership_id).eq("user_id", getCurrentUserId()).maybeSingle();
    if (membershipError) throw new Error(membershipError.message);
    if (!membership) throw new Error("Membership not found");
    const [{ data: interactions }, { data: notes }] = await Promise.all([
      supabase.from("contact_interactions").select("type, summary, interaction_date, group_id, action_items").eq("user_id", getCurrentUserId()).eq("contact_id", (membership as any).contact_id).order("interaction_date", { ascending: false }).limit(5),
      supabase.from("notes").select("title, content, created_at, metadata").eq("user_id", getCurrentUserId()).contains("metadata", { people: [(membership as any).contacts?.name] }).order("created_at", { ascending: false }).limit(3),
    ]);
    const { result, credits } = await openRouterWithCredits(supabase, OPENROUTER_API_KEY, getCurrentUserId(), "group_next_step", "chat/completions", { model: "deepseek/deepseek-v4-flash", temperature: 0.2, response_format: { type: "json_object" }, messages: [{ role: "system", content: "Suggest one concrete next step for a relationship/group pipeline. Return only JSON with title, due_date_offset_days, priority, reasoning. priority must be low, normal, high, or urgent." }, { role: "user", content: JSON.stringify({ group: (membership as any).contact_groups, person: (membership as any).contacts, recent_interactions: interactions || [], recent_notes: (notes || []).map(noteText) }) }] });
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
      supabase.from("contact_group_memberships").select("*, contacts:contact_id(name, company, role)").eq("group_id", group.id).eq("user_id", getCurrentUserId()).is("archived_at", null).order("last_movement_at", { ascending: true }),
      supabase.from("contact_interactions").select("interaction_date, type, summary, contact_id, group_id").eq("user_id", getCurrentUserId()).eq("group_id", group.id).gte("interaction_date", since).order("interaction_date", { ascending: false }),
      supabase.from("action_items").select("content, status, priority, due_date, contact_id, metadata").eq("user_id", getCurrentUserId()).eq("metadata->>group_id", group.id).order("created_at", { ascending: false }),
    ]);
    const { result, credits } = await openRouterWithCredits(supabase, OPENROUTER_API_KEY, getCurrentUserId(), "group_briefing", "chat/completions", { model: "deepseek/deepseek-v4-flash", temperature: 0.25, messages: [{ role: "system", content: "Generate a concise weekly group briefing in Markdown with these exact sections: ## Movement, ## Stale Members, ## Top Priorities for Next Week, ## Goals Progress. Ground every claim in provided data." }, { role: "user", content: JSON.stringify({ group, period_days: days, memberships: memberships || [], interactions: interactions || [], action_items: actions || [] }) }] });
    const briefing = String(result?.choices?.[0]?.message?.content || "").trim();
    const generatedAt = new Date().toISOString();
    const { error } = await supabase.from("group_briefings").insert({ user_id: getCurrentUserId(), group_id: group.id, period_days: days, briefing_markdown: briefing, generated_at: generatedAt });
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
      supabase.from("contact_group_memberships").select("contact_id, contacts:contact_id(name)").eq("group_id", group.id).eq("user_id", getCurrentUserId()).is("archived_at", null),
      supabase.from("contacts").select("id, name, company, role, tags, notes, metadata").eq("user_id", getCurrentUserId()).is("merged_into", null).order("name"),
      supabase.from("notes").select("id, title, content, metadata, created_at").eq("user_id", getCurrentUserId()).eq("is_trashed", false).order("created_at", { ascending: false }).limit(100),
    ]);
    const structuredImport = await importGroupMembersFromNotes(supabase, getCurrentUserId(), group, notes || []);
    if (structuredImport) return jsonTool({ ok: true, mode: "structured_import", ...structuredImport });
    const existingIds = new Set((memberships || []).map((m: any) => m.contact_id));
    const candidates = (contacts || []).filter((contact: any) => !existingIds.has(contact.id));
    const { result, credits } = await openRouterWithCredits(supabase, OPENROUTER_API_KEY, getCurrentUserId(), "group_member_suggestions", "chat/completions", { model: "deepseek/deepseek-v4-flash", temperature: 0.2, response_format: { type: "json_object" }, messages: [{ role: "system", content: "Suggest contacts to add to this group. Return JSON: { suggestions: [{ contact_id, contact_name, reasoning, confidence }] }. Use only provided contact_id values. confidence is 0-1." }, { role: "user", content: JSON.stringify({ group, existing_members: (memberships || []).map((m: any) => m.contacts?.name).filter(Boolean), candidates, recent_notes: (notes || []).map(noteText) }) }] });
    const suggestions = Array.isArray(result?.choices?.[0]?.message?.content) ? [] : JSON.parse(result?.choices?.[0]?.message?.content || "{}").suggestions || [];
    const candidateIds = new Set(candidates.map((contact: any) => contact.id));
    const defaultStatus = Array.isArray(group.stages) ? group.stages[0]?.id : null;
    const rawRows = suggestions.filter((suggestion: any) => candidateIds.has(suggestion.contact_id) && Number(suggestion.confidence) > 0.6).map((suggestion: any) => {
      const reasoning = suggestion.reasoning || "";
      const contactId = String(suggestion.contact_id);
      const sensitive = ["health", "medical", "diagnosis", "therapy", "politics", "religion", "financial", "salary", "private", "confidential"].some((term) => `${group.name} ${group.description || ""} ${reasoning}`.toLowerCase().includes(term));
      return { user_id: getCurrentUserId(), suggestion_type: "group_member_suggestion", title: `Add ${suggestion.contact_name || "contact"} to ${group.name}`, description: reasoning || null, confidence_score: Number(suggestion.confidence), is_sensitive: sensitive, target_entity_type: "contact_group", target_entity_id: group.id, payload: { group_id: group.id, contact_id: contactId, contact_name: suggestion.contact_name || null, group_name: group.name, reasoning, default_status: defaultStatus }, suppression_key: buildGroupMemberSuppressionKey(group.id, contactId) };
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
    const { data: notes, error } = await supabase.from("notes").select("id, title, content, metadata, created_at").eq("user_id", getCurrentUserId()).eq("is_trashed", false).order("created_at", { ascending: false }).limit(100);
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
    const { data: notes, error } = await supabase.from("notes").select("id, title, content, metadata, created_at").eq("user_id", getCurrentUserId()).eq("is_trashed", false).order("created_at", { ascending: false }).limit(100);
    if (error) throw new Error(error.message);
    const result = await importGroupMembersFromNotes(supabase, getCurrentUserId(), group, notes || []);
    return jsonTool(result ? { ok: true, ...result } : { ok: false, error: "No matching structured note found" });
  } catch (err: unknown) {
    return { content: [{ type: "text" as const, text: `Error: ${(err as Error).message}` }], isError: true };
  }
});

server.registerTool("review_group_member_suggestion", { title: "Review Group Member Suggestion", description: "Apply Review Queue actions for Group member suggestions using the same Keep, Roll Back, and Never Again behavior as the app.", inputSchema: { review_queue_id: z.string(), action: z.enum(["keep", "roll_back", "never_again"]) } }, async ({ review_queue_id, action }) => {
  try {
    const { data: item, error: fetchError } = await supabase.from("review_queue").select("*").eq("user_id", getCurrentUserId()).eq("id", review_queue_id).eq("suggestion_type", "group_member_suggestion").maybeSingle();
    if (fetchError) throw new Error(fetchError.message);
    if (!item) throw new Error("Group member suggestion not found");
    const payload = (item as any).payload || {};
    let membershipId = (item as any).target_entity_id;
    if (action === "keep") {
      if (!membershipId) {
        const { data: existing } = await supabase.from("contact_group_memberships").select("id").eq("user_id", getCurrentUserId()).eq("group_id", payload.group_id).eq("contact_id", payload.contact_id).is("archived_at", null).maybeSingle();
        membershipId = existing?.id;
      }
      if (!membershipId) {
        const { data, error } = await supabase.from("contact_group_memberships").insert({ user_id: getCurrentUserId(), group_id: payload.group_id, contact_id: payload.contact_id, status: payload.default_status || null, reason: (item as any).description || null }).select("id").single();
        if (error || !data) throw new Error(error?.message || "Could not create membership");
        membershipId = data.id;
      }
      await supabase.from("review_queue").update({ status: "kept", target_entity_type: "contact_group_membership", target_entity_id: membershipId, applied_at: (item as any).applied_at || new Date().toISOString(), reviewed_at: new Date().toISOString() }).eq("id", review_queue_id).eq("user_id", getCurrentUserId());
      return jsonTool({ ok: true, status: "kept", membership_id: membershipId });
    }
    if (membershipId) await supabase.from("contact_group_memberships").delete().eq("user_id", getCurrentUserId()).eq("id", membershipId);
    if (action === "never_again") await supabase.from("ai_suggestion_suppressions").upsert({ user_id: getCurrentUserId(), suggestion_type: "group_member_suggestion", target_entity_type: (item as any).target_entity_type, target_entity_id: (item as any).target_entity_id, normalized_value: String(payload.contact_id || "").toLowerCase(), source_category: null, suppression_key: (item as any).suppression_key || buildGroupMemberSuppressionKey(payload.group_id, payload.contact_id) }, { onConflict: "user_id,suppression_key" });
    await supabase.from("review_queue").update({ status: action === "never_again" ? "blocked" : "removed", blocked_at: action === "never_again" ? new Date().toISOString() : null, reviewed_at: new Date().toISOString() }).eq("id", review_queue_id).eq("user_id", getCurrentUserId());
    return jsonTool({ ok: true, status: action === "never_again" ? "blocked" : "removed" });
  } catch (err: unknown) {
    return { content: [{ type: "text" as const, text: `Error: ${(err as Error).message}` }], isError: true };
  }
});

server.registerTool("list_collections", { title: "List Collections", description: "List all collections the user has created. Returns each collection's name, slug, description, icon, and the agent_instructions that explain how to capture into it. Call this once at the start of a session, or whenever the user mentions a topic that might fit an existing collection, to know what's available.", inputSchema: {} }, async () => {
  return withLoggedCollectionTool("list_collections", {}, async () => {
    const { data, error } = await supabase.from("collections").select("id, slug, name, icon, description, agent_instructions, field_schema").eq("user_id", getCurrentUserId()).order("updated_at", { ascending: false });
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
    const { data: item, error } = await supabase.from("collection_items").insert({ user_id: getCurrentUserId(), collection_id: collection.id, data }).select("id, title").single();
    if (error || !item) throw new Error(error?.message || "Could not add collection item");
    return { id: item.id, title: item.title, collection_slug: collection.slug, item_url: collectionItemUrl(collection.slug, item.id) };
  });
});

server.registerTool("update_collection_item", { title: "Update Collection Item", description: "Update an existing item in a collection. Useful for status changes, follow-up updates, adding notes to an existing entry.", inputSchema: { item_id: z.string(), data: z.record(z.string(), z.any()) } }, async ({ item_id, data }) => {
  return withLoggedCollectionTool("update_collection_item", { item_id, data }, async () => {
    const { data: existing, error: existingError } = await supabase.from("collection_items").select("id, collection_id, data, collections:collection_id(*)").eq("user_id", getCurrentUserId()).eq("id", item_id).maybeSingle();
    if (existingError) throw new Error(existingError.message);
    if (!existing) throw new Error("Collection item not found");
    const collection = (existing as any).collections;
    validateCollectionData(collection, data || {});
    const merged = { ...((existing as any).data || {}), ...(data || {}) };
    const { data: updated, error } = await supabase.from("collection_items").update({ data: merged }).eq("user_id", getCurrentUserId()).eq("id", item_id).select("id, title, updated_at").single();
    if (error || !updated) throw new Error(error?.message || "Could not update collection item");
    return { id: updated.id, title: updated.title, updated_at: updated.updated_at };
  });
});

server.registerTool("list_collection_items", { title: "List Collection Items", description: "Search and list items within a specific collection. Supports text search and filtering by indexable date/number/text columns. Use this to retrieve context — 'what was the last thing I logged about X', 'what's coming up', 'who hasn't been followed up with'.", inputSchema: { collection_slug: z.string(), search: z.string().optional(), limit: z.number().optional().default(20), date_from: z.string().optional(), date_to: z.string().optional(), status: z.string().optional(), sort: z.enum(["recent", "oldest", "updated"]).optional().default("recent") } }, async ({ collection_slug, search, limit, date_from, date_to, status, sort }) => {
  return withLoggedCollectionTool("list_collection_items", { collection_slug, search, limit, date_from, date_to, status, sort }, async () => {
    const collection = await getCollectionBySlug(collection_slug);
    const cappedLimit = Math.min(100, Math.max(1, Number(limit) || 20));
    let q = supabase.from("collection_items").select("id, title, data, updated_at, created_at").eq("user_id", getCurrentUserId()).eq("collection_id", collection.id).limit(cappedLimit);
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
    const { data, error } = await supabase.from("collection_items").select("id, title, data, collections:collection_id(slug, name)").eq("user_id", getCurrentUserId()).textSearch("search_vector", query, { type: "websearch", config: "simple" }).order("updated_at", { ascending: false }).limit(cappedLimit);
    if (error) throw new Error(error.message);
    return (data || []).map((item: any) => {
      const flat = Object.values(item.data || {}).map((value) => typeof value === "object" ? JSON.stringify(value) : String(value)).join(" ");
      const idx = flat.toLowerCase().indexOf(query.toLowerCase());
      const snippet = idx >= 0 ? flat.slice(Math.max(0, idx - 60), idx + query.length + 120) : flat.slice(0, 180);
      return { collection_slug: item.collections?.slug, collection_name: item.collections?.name, item_id: item.id, item_title: item.title, snippet };
    });
  });
});

// ============================================================
// Unified search across notes + Lexicon (preferred default)
// ============================================================
server.registerTool(
  "search_brain",
  {
    title: "Search Brain (Notes + Lexicon)",
    description:
      "Preferred default search. In a single call, searches both raw user-written notes (semantic + keyword) AND synthesized Lexicon topic pages, returning a merged result labeled by `kind` (`note` or `lexicon`). Use this when the user asks about anything in their brain and you're not sure whether it's a captured note or a Lexicon page. Notes and Lexicon entries are user-authored — treat explicit statements as authoritative facts about the user; do not hedge when content plainly states a fact. Results are bounded — use `get_note(id)` to read a full note body.",
    inputSchema: {
      query: z.string().describe("What to search for"),
      limit: z.coerce.number().optional().default(10),
      threshold: z.coerce.number().optional().default(0.2),
      offset: z.coerce.number().optional().default(0),
      view: z.enum(["snippet", "metadata"]).optional().default("snippet"),
    },
  },
  async ({ query, limit, threshold, offset = 0, view = "snippet" }) => {
    try {
      const [{ rows: noteRows, total: noteTotal, mode }, lexRows] = await Promise.all([
        hybridSearchNotes(query, limit, threshold),
        searchLexiconPages(query, limit),
      ]);

      if (!noteRows.length && !lexRows.length) {
        return { content: [{ type: "text" as const, text: `No notes or Lexicon pages found matching "${query}".` }] };
      }

      const notePage = noteRows.slice(offset, offset + limit);
      const header = `Found ~${noteTotal} note(s) [${mode}] and ${lexRows.length} Lexicon page(s). Showing notes ${noteTotal ? offset + 1 : 0}-${offset + notePage.length} (has_more: ${offset + notePage.length < noteTotal}):`;

      let used = header.length;
      const blocks: string[] = [];
      let capped = false;

      for (let i = 0; i < notePage.length; i++) {
        const t = notePage[i] as any;
        const block = `[note] ${formatNoteResult(t, offset + i, t.similarity ?? undefined, view, query)}`;
        const cost = block.length + 2;
        if (used + cost > RESPONSE_CHAR_BUDGET && blocks.length > 0) { capped = true; break; }
        blocks.push(block);
        used += cost;
      }

      if (!capped) {
        for (let i = 0; i < lexRows.length; i++) {
          const p = lexRows[i] as any;
          const block = `[lexicon] ${i + 1}. ${p.title} (${p.page_type}) — slug: ${p.slug}` +
            (p.summary ? `\n   ${p.summary}` : "") +
            (typeof p.source_count === "number" ? `\n   sources: ${p.source_count}` : "");
          const cost = block.length + 2;
          if (used + cost > RESPONSE_CHAR_BUDGET && blocks.length > 0) { capped = true; break; }
          blocks.push(block);
          used += cost;
        }
      }

      let text = `${header}\n\n${blocks.join("\n\n")}`;
      if (capped) text += `\n\n… capped (response budget reached). Re-run with a higher offset for more notes, or get_note(id) for a full note body.`;
      return { content: [{ type: "text" as const, text }] };
    } catch (err: unknown) {
      return { content: [{ type: "text" as const, text: `Error: ${(err as Error).message}` }], isError: true };
    }
  }
);


// ============================================================
// Backward-compat aliases (deprecated old "thought" naming)
// ============================================================
server.registerTool(
  "search_thoughts",
  {
    title: "Search Thoughts (deprecated alias)",
    description: "Deprecated alias for `search_notes`. Use `search_notes` (or `search_brain` for notes + Lexicon) instead.",
    inputSchema: {
      query: z.string(),
      limit: z.number().optional().default(10),
      threshold: z.number().optional().default(0.25),
    },
  },
  searchNotesHandler
);

server.registerTool(
  "list_recent",
  {
    title: "List Recent (deprecated alias)",
    description: "Deprecated alias for `list_recent_notes`. Use `list_recent_notes` instead.",
    inputSchema: {
      limit: z.number().optional().default(10),
      type: z.string().optional(),
      topic: z.string().optional(),
      person: z.string().optional(),
      days: z.number().optional(),
    },
  },
  listRecentNotesHandler
);

server.registerTool(
  "capture_thought",
  {
    title: "Capture Thought (deprecated alias)",
    description: "Deprecated alias for `capture_note`. Use `capture_note` instead.",
    inputSchema: { content: z.string() },
  },
  captureNoteHandler
);


// ============================================================
// World: entities (non-person things) and dated claims (facts)
// ============================================================

const ENTITY_FIELDS = "id, name, aliases, entity_type, description, tags, metadata, ai_visibility, is_sensitive, created_at, updated_at";

function visibleEntities(query: any) {
  return query.eq("ai_visibility", "visible");
}

/** Resolve entities by name or alias, creating the missing ones. */
async function resolveOrCreateEntitiesByName(names: string[]): Promise<any[]> {
  const wanted = uniqueStrings(names || []);
  if (!wanted.length) return [];
  const userId = getCurrentUserId();
  const { data: existing } = await supabase.from("entities").select(ENTITY_FIELDS).eq("user_id", userId);
  const rows = existing || [];
  const out: any[] = [];
  for (const name of wanted) {
    const needle = name.trim().toLowerCase();
    if (!needle) continue;
    const hit = rows.find(
      (e: any) =>
        String(e.name).toLowerCase() === needle ||
        (Array.isArray(e.aliases) && e.aliases.some((a: string) => String(a).toLowerCase() === needle)),
    );
    if (hit) {
      out.push(hit);
      continue;
    }
    const { data, error } = await supabase
      .from("entities")
      .insert({ user_id: userId, name: name.trim(), entity_type: "other" })
      .select(ENTITY_FIELDS)
      .single();
    if (error) throw new Error(error.message);
    rows.push(data);
    out.push(data);
  }
  return out;
}

async function findEntity(idOrName: string): Promise<any | null> {
  const userId = getCurrentUserId();
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(idOrName)) {
    const { data } = await supabase.from("entities").select(ENTITY_FIELDS).eq("user_id", userId).eq("id", idOrName).maybeSingle();
    if (data) return data;
  }
  const { data: rows } = await supabase.from("entities").select(ENTITY_FIELDS).eq("user_id", userId);
  const needle = idOrName.trim().toLowerCase();
  return (
    (rows || []).find(
      (e: any) =>
        String(e.name).toLowerCase() === needle ||
        (Array.isArray(e.aliases) && e.aliases.some((a: string) => String(a).toLowerCase() === needle)),
    ) ||
    (rows || []).find((e: any) => String(e.name).toLowerCase().includes(needle)) ||
    null
  );
}

server.registerTool(
  "create_entity",
  {
    title: "Create Entity",
    description: "Create a non-person thing in the user's World: a place, organization, project, object or pet. People belong in People, not here.",
    inputSchema: {
      name: z.string(),
      entity_type: z.string().optional().describe("place | organization | project | thing | pet | other (open vocabulary)"),
      aliases: z.array(z.string()).optional(),
      description: z.string().optional(),
      tags: z.array(z.string()).optional(),
    },
  },
  async ({ name, entity_type, aliases, description, tags }) => {
    const existing = await findEntity(name);
    if (existing) return jsonTool({ tool: "create_entity", created: false, note: "An entity with that name or alias already exists.", entity: existing });
    const { data, error } = await supabase
      .from("entities")
      .insert({
        user_id: getCurrentUserId(),
        name: name.trim(),
        entity_type: (entity_type || "other").trim().toLowerCase(),
        aliases: aliases || [],
        description: description || null,
        tags: tags || [],
      })
      .select(ENTITY_FIELDS)
      .single();
    if (error) return jsonTool({ error: error.message });
    return jsonTool({ tool: "create_entity", created: true, entity: data });
  },
);

server.registerTool(
  "search_entities",
  {
    title: "Search Entities",
    description: "Search the user's World of non-person entities by name, alias, description or type.",
    inputSchema: { query: z.string().optional(), entity_type: z.string().optional(), limit: z.number().optional().default(25) },
  },
  async ({ query, entity_type, limit }) => {
    let q = visibleEntities(supabase.from("entities").select(ENTITY_FIELDS).eq("user_id", getCurrentUserId())).order("name").limit(limit);
    if (entity_type) q = q.eq("entity_type", entity_type.trim().toLowerCase());
    const { data, error } = await q;
    if (error) return jsonTool({ error: error.message });
    let rows = data || [];
    if (query?.trim()) {
      const needle = query.trim().toLowerCase();
      rows = rows.filter(
        (e: any) =>
          String(e.name).toLowerCase().includes(needle) ||
          String(e.description || "").toLowerCase().includes(needle) ||
          (Array.isArray(e.aliases) && e.aliases.some((a: string) => String(a).toLowerCase().includes(needle))),
      );
    }
    return jsonTool({ tool: "search_entities", count: rows.length, entities: rows });
  },
);

server.registerTool(
  "get_entity_context",
  {
    title: "Get Entity Context",
    description: "Full context for one entity: the entity, its current facts (claims), recent moments it appears in, and notes mentioning it.",
    inputSchema: { id_or_name: z.string(), include_history: z.boolean().optional().default(false) },
  },
  async ({ id_or_name, include_history }) => {
    const entity = await findEntity(id_or_name);
    if (!entity) return jsonTool({ error: `No entity found matching "${id_or_name}".` });
    if (entity.ai_visibility === "hidden") return jsonTool({ error: "This entity is hidden from AI in Menerio." });
    const userId = getCurrentUserId();
    const today = todayISO();

    const { data: claimRows } = await supabase
      .from("claims")
      .select("*")
      .eq("user_id", userId)
      .eq("subject_type", "entity")
      .eq("subject_id", entity.id)
      .order("valid_from", { ascending: false, nullsFirst: false });
    const claims = sortClaims((claimRows || []) as any);
    const current = claims.filter((c: any) => isCurrentClaim(c, today));

    const { data: links } = await supabase.from("moment_entities").select("moment_id").eq("entity_id", entity.id).limit(50);
    let moments: any[] = [];
    if (links?.length) {
      let mq = supabase
        .from("moments")
        .select("id, title, description, happened_at, status, category")
        .eq("user_id", userId)
        .is("deleted_at", null)
        .in("id", links.map((l: any) => l.moment_id))
        .order("happened_at", { ascending: false })
        .limit(20);
      mq = await applyVisibility(mq, "moments", supabase, userId);
      const { data } = await mq;
      moments = data || [];
    }

    const needles = uniqueStrings([entity.name, ...(entity.aliases || [])]);
    let notes: any[] = [];
    if (needles.length) {
      const escaped = needles.map((n) => n.replace(/[,()'"\\*%_]/g, " ").trim()).filter(Boolean);
      const nq = supabase
        .from("notes")
        .select("id, title, created_at, ai_visibility, person_id, metadata")
        .eq("user_id", userId)
        .or(escaped.map((n) => `title.ilike.*${n}*,content.ilike.*${n}*`).join(","))
        .order("created_at", { ascending: false })
        .limit(10);
      const { data } = await nq;
      notes = await filterVisibleNotes(data || [], supabase, userId);
      notes = notes.map((n: any) => ({ id: n.id, title: n.title, created_at: n.created_at }));
    }

    return jsonTool({
      tool: "get_entity_context",
      entity,
      facts: current,
      history: include_history ? claims.filter((c: any) => !isCurrentClaim(c, today)) : undefined,
      moments,
      notes,
    });
  },
);

server.registerTool(
  "add_claim",
  {
    title: "Add Claim",
    description: "Record a dated fact about the user, a person, or an entity (e.g. employer, lives-in, owner). Any overlapping earlier fact with the same attribute is closed with an end date — nothing is deleted. Relationships between people are NOT claims: use the relationship tools instead.",
    inputSchema: {
      subject_type: z.enum(["self", "contact", "entity"]),
      subject_name: z.string().optional().describe("Person or entity name. Omit for subject_type 'self'."),
      subject_id: z.string().optional().describe("Explicit contact or entity id, if known."),
      attribute: z.string().describe("Open vocabulary, e.g. employer, role, lives-in, owner, status"),
      value: z.string(),
      valid_from: z.string().optional().describe("YYYY-MM-DD when this became true"),
      valid_to: z.string().optional().describe("YYYY-MM-DD when this stopped being true"),
      confidence: z.enum(["certain", "likely", "unsure"]).optional().default("likely"),
      source_note_id: z.string().optional(),
    },
  },
  async ({ subject_type, subject_name, subject_id, attribute, value, valid_from, valid_to, confidence, source_note_id }) => {
    try {
      if (isReservedAttribute(attribute)) {
        return jsonTool({
          error: "Relationships between people are not claims. Use the relationship path so canonical labels, inverses and the rejection ledger stay authoritative.",
        });
      }
      const userId = getCurrentUserId();
      let resolvedId: string | null = null;
      if (subject_type === "contact") {
        if (subject_id) resolvedId = subject_id;
        else if (subject_name) {
          const contacts = await resolveOrCreateContactsByName([subject_name]);
          resolvedId = contacts[0]?.id ?? null;
        }
        if (!resolvedId) return jsonTool({ error: "subject_name or subject_id is required for a contact claim." });
        await assertWritable(supabase, userId, "contact", resolvedId);
      } else if (subject_type === "entity") {
        if (subject_id) resolvedId = subject_id;
        else if (subject_name) {
          const entities = await resolveOrCreateEntitiesByName([subject_name]);
          resolvedId = entities[0]?.id ?? null;
        }
        if (!resolvedId) return jsonTool({ error: "subject_name or subject_id is required for an entity claim." });
      }

      const { claim, superseded } = await addClaimWithSupersede(supabase, {
        user_id: userId,
        subject_type,
        subject_id: resolvedId,
        attribute,
        value,
        valid_from: valid_from ?? null,
        valid_to: valid_to ?? null,
        confidence,
        source_type: source_note_id ? "note" : "ai",
        source_id: source_note_id ?? null,
      });
      return jsonTool({ tool: "add_claim", claim, superseded_count: superseded.length, superseded });
    } catch (err: unknown) {
      return jsonTool({ error: err instanceof Error ? err.message : "Unknown error" });
    }
  },
);

server.registerTool(
  "get_claims",
  {
    title: "Get Claims",
    description: "Read dated facts. Mode 'current' returns what is true now, 'history' returns everything including ended facts, 'changed_since' returns facts that started or ended after a date.",
    inputSchema: {
      subject_type: z.enum(["self", "contact", "entity"]).optional(),
      subject_name: z.string().optional(),
      subject_id: z.string().optional(),
      attribute: z.string().optional(),
      mode: z.enum(["current", "history", "changed_since"]).optional().default("current"),
      since: z.string().optional().describe("YYYY-MM-DD, required for mode 'changed_since'"),
      limit: z.number().optional().default(100),
    },
  },
  async ({ subject_type, subject_name, subject_id, attribute, mode, since, limit }) => {
    const userId = getCurrentUserId();
    let q = supabase.from("claims").select("*").eq("user_id", userId).order("valid_from", { ascending: false, nullsFirst: false }).limit(limit);
    if (subject_type) q = q.eq("subject_type", subject_type);
    if (attribute) q = q.eq("attribute", normalizeAttribute(attribute));

    let resolvedId = subject_id ?? null;
    if (!resolvedId && subject_name && subject_type && subject_type !== "self") {
      if (subject_type === "entity") resolvedId = (await findEntity(subject_name))?.id ?? null;
      else {
        const { data } = await supabase.from("contacts").select("id").eq("user_id", userId).ilike("name", `%${subject_name}%`).is("merged_into", null).limit(1);
        resolvedId = data?.[0]?.id ?? null;
      }
      if (!resolvedId) return jsonTool({ message: `No ${subject_type} found matching "${subject_name}".` });
    }
    if (subject_type === "self") q = q.is("subject_id", null);
    else if (resolvedId) q = q.eq("subject_id", resolvedId);

    const { data, error } = await q;
    if (error) return jsonTool({ error: error.message });
    let rows = sortClaims((data || []) as any);
    const today = todayISO();
    if (mode === "current") rows = rows.filter((c: any) => isCurrentClaim(c, today));
    else if (mode === "changed_since") {
      if (!since) return jsonTool({ error: "mode 'changed_since' requires a `since` date (YYYY-MM-DD)." });
      rows = changedSince(rows as any, since);
    }
    return jsonTool({ tool: "get_claims", mode, count: rows.length, claims: rows });
  },
);

const app = new Hono();
const transport = new StreamableHTTPTransport();

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
      name: "menerio",
      version: "1.0.0",
      // Bumped by hand whenever this function is deployed, so anyone can tell
      // which build is live without opening a dashboard.
      build: "2026-08-18-every-key-a-door",
      transport: "streamable-http",
      auth: "Authorization: Bearer mnr_<api key>",
      accepts_api_keys: true,
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
    return c.json({ error: auth.error.message }, auth.error.status as 401 | 403);
  }

  return await requestContext.run({ userId: auth.userId!, scopes: auth.scopes! }, async () => {
    return await enterVisibilityScope(async () => {
      addCollectionItemTool.update({ description: await buildAddCollectionItemDescription() });
      if (!server.isConnected()) {
        await server.connect(transport);
      }
      return await transport.handleRequest(c);
    });
  });
});


Deno.serve(app.fetch);
