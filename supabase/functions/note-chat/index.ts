import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  checkBalance,
  openRouterWithCredits,
  insufficientCreditsResponse,
} from "../_shared/llm-credits.ts";
import { resolveSystemPrompt, resolveConfig } from "../_shared/llm-router.ts";
import {
  NOTE_CHAT_NOTE_MODE_PROMPT,
  NOTE_CHAT_GENERAL_MODE_PROMPT,
  NOTE_CHAT_SUMMARIZE_PROMPT,
} from "../_shared/llm-defaults.ts";
import { getUserProfile, formatUserProfileDigest } from "../_shared/user-profile.ts";
import { buildAwarenessContext } from "../_shared/awareness.ts";
import { webSearchTool, runWebSearch } from "../_shared/web-search.ts";
import { loadUserMcpTools, type LoadedMcpTools } from "../_shared/mcp-client.ts";
import { runAgentLoop } from "../_shared/agent-loop.ts";
import {
  READ_TOOL_SCHEMAS,
  READ_TOOL_NAMES,
  loadPersonProfile,
  executeReadTool,
} from "../_shared/read-tools.ts";

// Fallback model for the in-note agent. Overridable per environment via the
// `llm_call_configs` row for "note-chat.main"/"note-chat.general" (admin LLM
// panel) — set a fast, capable model (e.g. a Sonnet-class model) there.
const NOTE_CHAT_DEFAULT_MODEL = "minimax/minimax-m2.7";
const SUMMARIZE_DEFAULT_MODEL = "deepseek/deepseek-v4-flash";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const OPENROUTER_API_KEY = Deno.env.get("OPENROUTER_API_KEY")!;

const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// Tool definitions for the LLM. The read tools (semantic/text/media search,
// person lookup) are shared with conversation-chat via _shared/read-tools.ts;
// the write tools below are local to note-chat (they act on the current note).
const WRITE_TOOLS = [
  {
    type: "function",
    function: {
      name: "update_note_metadata",
      description:
        "Update metadata fields on the current note (topics, type, sentiment, people, summary, etc.).",
      parameters: {
        type: "object",
        properties: {
          metadata: {
            type: "object",
            description:
              "Key-value pairs to merge into the note metadata. Supported keys: topics (string[]), type (string), sentiment (string), people (string[]), summary (string), action_items (string[]), dates_mentioned (string[])",
          },
        },
        required: ["metadata"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "update_note_tags",
      description: "Set the tags on the current note (replaces existing tags).",
      parameters: {
        type: "object",
        properties: {
          tags: {
            type: "array",
            items: { type: "string" },
            description: "Array of tags to set on the note",
          },
        },
        required: ["tags"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "add_wikilink",
      description:
        "Create a wikilink connection from the current note to another note by its ID.",
      parameters: {
        type: "object",
        properties: {
          target_note_id: {
            type: "string",
            description: "The UUID of the note to link to",
          },
          target_note_title: {
            type: "string",
            description: "The title of the target note (for display)",
          },
        },
        required: ["target_note_id", "target_note_title"],
        additionalProperties: false,
      },
    },
  },
];

// Full tool set = shared read tools + safe content-edit tools + note-local
// metadata/tag/link write tools.
const TOOLS = [...READ_TOOL_SCHEMAS, ...NOTE_EDIT_TOOL_SCHEMAS, ...WRITE_TOOLS];


// System prompts now resolved at runtime from llm_call_configs
// (call_sites: "note-chat.main" with {{noteContext}}, "note-chat.general", "note-chat.summarize").
// Falls back to constants in llm-defaults.ts.

// Execute tool calls
async function executeTool(
  name: string,
  args: Record<string, unknown>,
  userId: string,
  noteId: string,
  editSession: NoteEditSession | null
): Promise<string> {
  // Read/lookup tools (note search, media search, person profile) are shared
  // with conversation-chat via _shared/read-tools.ts.
  if (READ_TOOL_NAMES.includes(name)) {
    return executeReadTool(db, OPENROUTER_API_KEY, userId, name, args);
  }

  // Content edits go through the safe, idempotent, non-destructive editor.
  if (NOTE_EDIT_TOOL_NAMES.includes(name)) {
    if (!editSession) {
      return JSON.stringify({ error: "No note is open — cannot edit." });
    }
    return executeNoteEditTool(db, userId, editSession, name, args);
  }

  switch (name) {

      const newMeta = args.metadata as Record<string, unknown>;
      const { data: note } = await db
        .from("notes")
        .select("metadata")
        .eq("id", noteId)
        .eq("user_id", userId)
        .single();
      if (!note) return JSON.stringify({ error: "Note not found" });
      const merged = { ...(note.metadata || {}), ...newMeta };
      const { error } = await db
        .from("notes")
        .update({ metadata: merged })
        .eq("id", noteId)
        .eq("user_id", userId);
      if (error) return JSON.stringify({ error: error.message });
      return JSON.stringify({
        success: true,
        action: "update_note_metadata",
        updated_fields: Object.keys(newMeta),
      });
    }

    case "update_note_tags": {
      const tags = args.tags as string[];
      const { error } = await db
        .from("notes")
        .update({ tags })
        .eq("id", noteId)
        .eq("user_id", userId);
      if (error) return JSON.stringify({ error: error.message });
      return JSON.stringify({
        success: true,
        action: "update_note_tags",
        tags,
      });
    }

    case "add_wikilink": {
      const targetId = args.target_note_id as string;
      const targetTitle = args.target_note_title as string;
      const { error } = await db.from("note_connections").insert({
        user_id: userId,
        source_note_id: noteId,
        target_note_id: targetId,
        connection_type: "manual_link",
        strength: 1.0,
        metadata: { created_by: "ai_chat" },
      });
      if (error) return JSON.stringify({ error: error.message });
      return JSON.stringify({
        success: true,
        action: "add_wikilink",
        target_note_id: targetId,
        target_note_title: targetTitle,
      });
    }

    default:
      return JSON.stringify({ error: `Unknown tool: ${name}` });
  }
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Unauthorized" }, 401);

    const token = authHeader.replace("Bearer ", "");
    const {
      data: { user },
      error: authErr,
    } = await db.auth.getUser(token);
    if (authErr || !user) return json({ error: "Unauthorized" }, 401);

    const body = await req.json();
    const { note_id, person_id, messages: chatMessages, mode, timezone } = body;

    if (!chatMessages || !Array.isArray(chatMessages))
      return json({ error: "messages required" }, 400);

    // Check credits
    const balance = await checkBalance(db, user.id);
    if (!balance.allowed) return insufficientCreditsResponse(corsHeaders);

    // Lightweight summarization mode — used by the client to compress
    // older turns into a rolling summary so context doesn't grow unbounded.
    if (mode === "summarize") {
      const transcript = chatMessages
        .map((m: any) => `${m.role === "user" ? "User" : "Assistant"}: ${m.content}`)
        .join("\n");
      try {
        const { effective: sumCfg } = await resolveConfig(db, "note-chat.summarize", {
          provider: "openrouter",
          model: SUMMARIZE_DEFAULT_MODEL,
        });
        const sumResult = await openRouterWithCredits(
          db,
          OPENROUTER_API_KEY,
          user.id,
          "note-chat:summarize",
          "chat/completions",
          {
            model: sumCfg.model,
            messages: [
              {
                role: "system",
                content: await resolveSystemPrompt(db, "note-chat.summarize", NOTE_CHAT_SUMMARIZE_PROMPT),
              },
              {
                role: "user",
                content: `Summarize this conversation:\n\n${transcript}`,
              },
            ],
          }
        );
        const summary = sumResult.result.choices?.[0]?.message?.content?.trim() || "";
        return json({
          summary,
          credits: sumResult.credits
            ? {
                remaining_tokens: sumResult.credits.remaining_tokens,
                remaining_credits: sumResult.credits.remaining_credits,
              }
            : null,
        });
      } catch (err: any) {
        if (err.message === "INSUFFICIENT_CREDITS") {
          return insufficientCreditsResponse(corsHeaders);
        }
        return json({ error: err.message || "Summarize failed" }, 500);
      }
    }

    // Determine mode: note-specific or general knowledge base
    const isNoteMode = !!note_id;
    let systemMessage: { role: string; content: string };
    let activeTools: typeof TOOLS;

    if (isNoteMode) {
      // Fetch current note for context
      const { data: note, error: noteErr } = await db
        .from("notes")
        .select(
          "id, title, content, tags, metadata, entity_type, related, structured_fields"
        )
        .eq("id", note_id)
        .eq("user_id", user.id)
        .single();

      if (noteErr || !note)
        return json({ error: "Note not found" }, 404);

      // Fetch media analysis (OCR, descriptions) for this note
      const { data: mediaData } = await db
        .from("media_analysis")
        .select("storage_path, media_type, page_number, original_filename, extracted_text, description, topics")
        .eq("note_id", note_id)
        .eq("analysis_status", "complete")
        .order("original_filename", { ascending: true })
        .order("page_number", { ascending: true, nullsFirst: true });

      // Build media context string
      let mediaContext = "";
      if (mediaData && mediaData.length > 0) {
        mediaContext = "\n\n--- MEDIA ANALYSIS (OCR & image descriptions) ---";
        const grouped = new Map<string, typeof mediaData>();
        for (const m of mediaData) {
          const key = m.original_filename || m.storage_path;
          if (!grouped.has(key)) grouped.set(key, []);
          grouped.get(key)!.push(m);
        }
        for (const [filename, entries] of grouped) {
          mediaContext += `\nFile: ${filename} (${entries[0].media_type})`;
          if (entries[0].description) mediaContext += `\n  Description: ${entries[0].description}`;
          if (entries[0].topics?.length) mediaContext += `\n  Topics: ${entries[0].topics.join(", ")}`;
          for (const entry of entries) {
            if (entry.extracted_text) {
              const pageLabel = entry.page_number ? `Page ${entry.page_number}` : "Extracted";
              mediaContext += `\n  ${pageLabel} text:\n    ${entry.extracted_text}`;
            }
          }
        }
        mediaContext += "\n--- END MEDIA ANALYSIS ---";
      }

      const noteContext = `\n\n--- CURRENT NOTE ---\nTitle: ${note.title}\nTags: ${(note.tags || []).join(", ") || "none"}\nMetadata: ${JSON.stringify(note.metadata || {})}\nContent:\n${note.content}\n--- END NOTE ---${mediaContext}`;

      systemMessage = {
        role: "system",
        content: await resolveSystemPrompt(db, "note-chat.main", NOTE_CHAT_NOTE_MODE_PROMPT, { noteContext }),
      };
      activeTools = TOOLS;
    } else {
      // General assistant mode — read tools over notes, media, and people.
      let systemContent = await resolveSystemPrompt(db, "note-chat.general", NOTE_CHAT_GENERAL_MODE_PROMPT);

      // If the user is on a person's profile page, inject that page's data
      // directly so questions about "this person" are answerable without the
      // model having to guess where to look. Appended in code (not via a
      // prompt placeholder) so it works regardless of the DB prompt config.
      if (person_id && typeof person_id === "string") {
        const p = await loadPersonProfile(db, user.id, person_id);
        if (p) {
          const entryLines = p.profile_entries
            .map((e) => `- [${e.category}] ${e.label}: ${e.value}`)
            .join("\n");
          const relLines = p.relationships
            .map((r) => `- ${r.from} — ${r.label} → ${r.to}`)
            .join("\n");
          systemContent += `\n\n--- CURRENT PERSON (the user is viewing this profile page) ---\nName: ${p.person.name}${p.person.aliases.length ? `\nAliases: ${p.person.aliases.join(", ")}` : ""}\nProfile entries:\n${entryLines || "(none)"}\nRelationships:\n${relLines || "(none)"}\n--- END CURRENT PERSON ---\nWhen the user says "this person" or refers to the profile they are looking at, they mean ${p.person.name}. Answer from this data directly when it already contains the answer — no tool calls needed for that.`;
        }
      }

      systemMessage = { role: "system", content: systemContent };

      // General mode: read/lookup tools only (no note-mutating tools).
      activeTools = TOOLS.filter((t) => READ_TOOL_NAMES.includes(t.function.name));
    }

    // Real-time awareness (date/time) + who-the-user-is context, injected once
    // for both modes. Small and size-capped — cheap tokens, big capability win.
    const awareness = buildAwarenessContext(
      typeof timezone === "string" ? timezone : undefined
    );
    let profileDigest = "";
    try {
      profileDigest = formatUserProfileDigest(await getUserProfile(db, user.id));
    } catch (e) {
      console.warn("note-chat: profile load failed:", (e as Error)?.message);
    }
    systemMessage.content += awareness + profileDigest;

    // Resolve the (configurable) model for this call site — admin LLM panel
    // rows for "note-chat.main"/"note-chat.general" override the default.
    const callSite = isNoteMode ? "note-chat.main" : "note-chat.general";
    const { effective: cfg } = await resolveConfig(db, callSite, {
      provider: "openrouter",
      model: NOTE_CHAT_DEFAULT_MODEL,
    });

    // On-demand extra tools: web search (always available) + the user's own MCP
    // servers (loaded only if they have any). MCP failures never break the chat.
    let mcp: LoadedMcpTools | null = null;
    try {
      mcp = await loadUserMcpTools(db, user.id);
    } catch (e) {
      console.warn("note-chat: MCP load failed:", (e as Error)?.message);
    }
    const loopTools = [...activeTools, webSearchTool, ...(mcp?.tools ?? [])];

    // Tool executor closure: web search + MCP passthrough + existing note tools.
    const runTool = async (
      name: string,
      args: Record<string, unknown>
    ): Promise<string> => {
      if (name === "web_search") {
        return runWebSearch(db, OPENROUTER_API_KEY, user.id, String(args.query ?? ""));
      }
      if (mcp && mcp.hasTool(name)) {
        return mcp.call(name, args);
      }
      return executeTool(name, args, user.id, note_id);
    };

    try {
      const loopResult = await runAgentLoop({
        db,
        apiKey: OPENROUTER_API_KEY,
        userId: user.id,
        creditFeature: "note-chat",
        model: cfg.model,
        systemPrompt: systemMessage.content,
        chatMessages,
        tools: loopTools,
        executeTool: runTool,
      });
      const c = loopResult.credits as any;
      return json({
        reply: loopResult.reply,
        tool_results: loopResult.toolResults,
        credits: c
          ? { remaining_tokens: c.remaining_tokens, remaining_credits: c.remaining_credits }
          : null,
      });
    } catch (err: any) {
      if (err?.message === "INSUFFICIENT_CREDITS") {
        return insufficientCreditsResponse(corsHeaders);
      }
      throw err;
    } finally {
      await mcp?.close();
    }
  } catch (err: any) {
    console.error("note-chat error:", err);
    return json({ error: err.message || "Internal error" }, 500);
  }
});
