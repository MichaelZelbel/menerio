import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { resolveSystemPrompt, resolveConfig } from "../_shared/llm-router.ts";
import { CONVERSATION_CHAT_PROMPT } from "../_shared/llm-defaults.ts";
import {
  balanceUnavailableResponse,
  checkBalance,
  getEmbeddingWithCredits,
  insufficientCreditsResponse,
} from "../_shared/llm-credits.ts";
import { getUserProfile, formatUserProfileDigest } from "../_shared/user-profile.ts";
import { buildAwarenessContext } from "../_shared/awareness.ts";
import { webSearchTool, runWebSearch } from "../_shared/web-search.ts";
import { loadUserMcpTools, type LoadedMcpTools } from "../_shared/mcp-client.ts";
import { runAgentLoop } from "../_shared/agent-loop.ts";
import { READ_TOOL_SCHEMAS, READ_TOOL_NAMES, executeReadTool } from "../_shared/read-tools.ts";
import { readUrlTool, createUrlReadSession, runReadUrl } from "../_shared/read-url-tool.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// Fallback model for Mira. Overridable via the "conversation-chat.main" row in
// the admin LLM panel — set a fast, capable model there.
const CONVERSATION_CHAT_DEFAULT_MODEL = "minimax/minimax-m2.7";

type Attachment = { name: string; content: string };
type ConversationContext = { context?: string; intent?: string; presetTone?: string; customTone?: string };

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  let mcp: LoadedMcpTools | null = null;
  try {
    const { message, personId, conversationContext, attachments, timezone } = await req.json();
    if (!message || typeof message !== "string") return json({ error: "message required" }, 400);
    if (personId && typeof personId !== "string") return json({ error: "personId must be a string" }, 400);

    const authHeader = req.headers.get("authorization");
    if (!authHeader?.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);

    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: { user }, error: userError } = await supabase.auth.getUser(authHeader.replace("Bearer ", ""));
    if (userError || !user) return json({ error: "Unauthorized" }, 401);

    const openRouterKey = Deno.env.get("OPENROUTER_API_KEY");
    if (!openRouterKey) throw new Error("OPENROUTER_API_KEY not configured");
    // Long-term memory used to embed its query through the Lovable chat gateway,
    // on the reasoning that the stored vectors came from there too and the two
    // had to share a space. The reasoning was right; the space was not. A chat
    // model asked to emit 768 numbers invents them, and the padding and
    // normalising downstream meant the result was always a unit vector of exactly
    // the right length, so nothing ever errored. Both sides of the comparison
    // were noise. Both now come from the real embeddings model, through the same
    // helper the note pipeline uses.

    // Enforce credits (Mira now runs on OpenRouter with credit accounting).
    const balance = await checkBalance(supabase, user.id);
    if (!balance.allowed) {
      return balance.unavailable
        ? balanceUnavailableResponse(corsHeaders)
        : insufficientCreditsResponse(corsHeaders);
    }

    const [historyResult, personResult, profileResult, notesResult, momentsResult, shortDocsResult] = await Promise.all([
      supabase.from("conversation_messages").select("role, content").eq("user_id", user.id).eq("person_id", personId).order("created_at", { ascending: false }).limit(10),
      personId ? supabase.from("contacts").select("id, name, notes, tags, aliases, metadata").eq("user_id", user.id).eq("id", personId).single() : Promise.resolve({ data: null }),
      personId ? supabase.from("profile_entries").select("label, value, profile_categories(name)").eq("user_id", user.id).eq("contact_id", personId).limit(50) : Promise.resolve({ data: [] }),
      supabase.from("notes").select("title, created_at, metadata").eq("user_id", user.id).eq("is_trashed", false).eq("ai_visibility", "visible").order("created_at", { ascending: false }).limit(50),
      supabase.from("moments").select("title, description, happened_at, impact_level, status").eq("user_id", user.id).is("deleted_at", null).order("happened_at", { ascending: false }).limit(50),
      personId ? supabase.from("person_documents").select("title, content").eq("user_id", user.id).eq("person_id", personId).eq("memory_type", "short_term") : Promise.resolve({ data: [] }),
    ]);

    const person = personResult.data as any;
    if (personId && !person) return json({ error: "Person not found" }, 404);

    const aliases = [person?.name, ...(person?.aliases || [])].filter(Boolean).map((n: string) => n.toLowerCase());
    const relatedNotes = (notesResult.data || []).filter((note: any) => {
      const people = note.metadata?.people;
      return Array.isArray(people) && aliases.some((name: string) => people.some((p: string) => String(p).toLowerCase() === name));
    }).slice(0, 10);
    const relatedMoments = (momentsResult.data || []).filter((m: any) => {
      const text = `${m.title || ""} ${m.description || ""}`.toLowerCase();
      return aliases.some((name: string) => text.includes(name));
    }).slice(0, 10);

    let longTermContext = "";
    if (personId) longTermContext = await searchLongTermMemory(supabase, openRouterKey, message, personId, user.id);

    const personContext = [
      buildPersonContext(person, profileResult.data || [], relatedNotes, relatedMoments),
      buildShortTermMemoryContext(shortDocsResult.data || []),
      longTermContext,
      buildAttachmentContext(attachments),
      buildConversationContext(conversationContext),
    ].filter(Boolean).join("\n\n");

    // System prompt: base (with person context) + who-the-user-is + date/time.
    let systemPrompt = await resolveSystemPrompt(
      supabase,
      "conversation-chat.main",
      CONVERSATION_CHAT_PROMPT,
      { personContext },
    );
    let profileDigest = "";
    try {
      profileDigest = formatUserProfileDigest(await getUserProfile(supabase, user.id));
    } catch (e) {
      console.warn("conversation-chat: profile load failed:", (e as Error)?.message);
    }
    systemPrompt += buildAwarenessContext(typeof timezone === "string" ? timezone : undefined) + profileDigest;

    // Model (configurable) + tools. Mira gets read/lookup tools + web search +
    // the user's MCP servers — no note-mutating tools (there's no current note).
    const { effective: cfg } = await resolveConfig(supabase, "conversation-chat.main", {
      provider: "openrouter",
      model: CONVERSATION_CHAT_DEFAULT_MODEL,
    });

    try {
      mcp = await loadUserMcpTools(supabase, user.id);
    } catch (e) {
      console.warn("conversation-chat: MCP load failed:", (e as Error)?.message);
    }
    const tools = [...READ_TOOL_SCHEMAS, webSearchTool, readUrlTool, ...(mcp?.tools ?? [])];

    // Per-turn URL read session: fetch cap plus a per-URL cache.
    const urlSession = createUrlReadSession();

    const runTool = async (name: string, args: Record<string, unknown>): Promise<string> => {
      if (name === "web_search") return runWebSearch(supabase, openRouterKey, user.id, String(args.query ?? ""));
      if (name === "read_url") return runReadUrl(urlSession, args.url);
      if (mcp && mcp.hasTool(name)) return mcp.call(name, args);
      if (READ_TOOL_NAMES.includes(name)) return executeReadTool(supabase, openRouterKey, user.id, name, args);
      return JSON.stringify({ error: `Unknown tool: ${name}` });
    };

    const history = (historyResult.data || []).reverse().map((m: any) => ({ role: m.role, content: m.content }));
    const chatMessages = [...history, { role: "user", content: message }];

    let reply: string;
    try {
      const loopResult = await runAgentLoop({
        db: supabase,
        apiKey: openRouterKey,
        userId: user.id,
        creditFeature: "conversation-chat",
        model: cfg.model,
        systemPrompt,
        chatMessages,
        tools,
        executeTool: runTool,
      });
      reply = loopResult.reply || "I couldn't generate a reply.";
    } catch (err: any) {
      if (err?.message === "INSUFFICIENT_CREDITS") return insufficientCreditsResponse(corsHeaders);
      throw err;
    }

    if (personId) {
      await supabase.from("conversation_messages").insert([
        { user_id: user.id, person_id: personId, role: "user", content: message },
        { user_id: user.id, person_id: personId, role: "assistant", content: reply },
      ]);
    }

    return json({ reply });
  } catch (error) {
    console.error("conversation-chat error:", error);
    return json({ error: error instanceof Error ? error.message : "Unknown error" }, 500);
  } finally {
    await mcp?.close();
  }
});

function buildPersonContext(person: any, profileEntries: any[], notes: any[], moments: any[]) {
  if (!person) return "";
  let ctx = `## Person Context\nName: ${person.name}\n`;
  if (person.aliases?.length) ctx += `Aliases: ${person.aliases.join(", ")}\n`;
  if (person.tags?.length) ctx += `Tags: ${person.tags.join(", ")}\n`;
  if (person.notes) ctx += `Notes: ${person.notes}\n`;
  if (profileEntries.length) {
    ctx += "\n### Profile\n";
    for (const entry of profileEntries) ctx += `- ${entry.profile_categories?.name || "Profile"}: ${entry.label} — ${entry.value}\n`;
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

function buildShortTermMemoryContext(docs: { title: string; content: string }[]) {
  const usable = docs.filter((d) => d.content?.trim());
  if (!usable.length) return "";
  return "## Short-term Memory\n" + usable.map((d) => `### ${d.title || "Note"}\n${d.content}`).join("\n\n");
}

function buildAttachmentContext(attachments?: Attachment[]) {
  if (!Array.isArray(attachments) || !attachments.length) return "";
  return "## Attachments\n" + attachments.map((a) => `### ${a.name}\n\`\`\`\n${String(a.content || "").slice(0, 50000)}\n\`\`\``).join("\n\n");
}

function buildConversationContext(ctx?: ConversationContext) {
  if (!ctx || (!ctx.context && !ctx.intent && !ctx.presetTone && !ctx.customTone)) return "";
  let out = "## Conversation Preparation\n";
  if (ctx.context) out += `Context:\n${ctx.context}\n`;
  if (ctx.intent) out += `Intent:\n${ctx.intent}\n`;
  const tones = [ctx.presetTone, ctx.customTone].filter(Boolean).join(", ");
  if (tones) out += `Tone guidance: ${tones}\n`;
  return out;
}

async function searchLongTermMemory(supabase: any, apiKey: string, query: string, personId: string, userId: string) {
  try {
    const { embedding } = await getEmbeddingWithCredits(
      supabase, apiKey, userId, "conversation-chat:long-term-memory", query.slice(0, 8000),
    );
    const { data, error } = await supabase.rpc("match_person_documents", {
      query_embedding: JSON.stringify(embedding),
      match_person_id: personId,
      match_user_id: userId,
      match_threshold: 0.3,
      match_count: 5,
    });
    if (error || !data?.length) return "";
    return "## Relevant Long-term Memory\n" + data.map((d: any) => `### ${d.title}\n${d.content}`).join("\n\n");
  } catch (error) {
    console.error("long-term memory search failed:", error);
    return "";
  }
}
