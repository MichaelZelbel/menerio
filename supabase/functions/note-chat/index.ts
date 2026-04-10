import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  checkBalance,
  openRouterWithCredits,
  insufficientCreditsResponse,
} from "../_shared/llm-credits.ts";

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

// Tool definitions for the LLM
const TOOLS = [
  {
    type: "function",
    function: {
      name: "search_notes_semantic",
      description:
        "Search the user's notes by meaning using vector similarity. Best for conceptual or fuzzy queries.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "The search query to find semantically similar notes",
          },
        },
        required: ["query"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "search_notes_text",
      description:
        "Search the user's notes by exact text match (ILIKE). Best for finding specific words, names, or phrases.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "The text to search for in note titles and content",
          },
        },
        required: ["query"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "append_to_note",
      description:
        "Append text (markdown) to the end of the currently open note.",
      parameters: {
        type: "object",
        properties: {
          text: {
            type: "string",
            description: "Markdown text to append to the note",
          },
        },
        required: ["text"],
        additionalProperties: false,
      },
    },
  },
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
      name: "search_media_text",
      description:
        "Search across OCR-extracted text and descriptions from images and PDFs in ALL of the user's notes. Use this when looking for text that might appear in scanned documents, photos, or PDF attachments.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "The text to search for in media extracted text and descriptions",
          },
        },
        required: ["query"],
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

const SYSTEM_PROMPT = `You are an AI assistant embedded in a note-taking application called Menerio (also known as "Open Brain"). You help the user work with their current note and their broader knowledge base.

You have access to tools to:
1. Search the user's notes semantically (vector search) or by text (ILIKE)
2. Search across OCR-extracted text and descriptions from images and PDFs in all notes
3. Append text to the current note
4. Update note metadata (topics, type, sentiment, people, summary, action_items, dates_mentioned)
5. Update note tags
6. Add wikilinks to connect the current note to other notes

Guidelines:
- When the user asks about their notes or knowledge, use search tools to find relevant information
- Use semantic search for conceptual queries, text search for specific names/phrases
- The current note's media analysis (OCR text, image descriptions) is included in the context below — check it before searching
- Use search_media_text to find text in images/PDFs across OTHER notes
- When modifying the note, confirm what you did
- Keep responses concise and helpful
- You can chain multiple tool calls if needed (e.g., search then link)
- When adding text, use proper markdown formatting
- The note content provided to you is the current state of the note`;

// Execute tool calls
async function executeTool(
  name: string,
  args: Record<string, unknown>,
  userId: string,
  noteId: string
): Promise<string> {
  switch (name) {
    case "search_notes_semantic": {
      const query = args.query as string;
      // Try to get embedding for semantic search
      try {
        const embResult = await openRouterWithCredits(
          db,
          OPENROUTER_API_KEY,
          userId,
          "note-chat:tool:semantic-search",
          "embeddings",
          { model: "openai/text-embedding-3-small", input: query }
        );
        const embedding = embResult.result.data[0].embedding;
        const embeddingStr = `[${embedding.join(",")}]`;
        const { data, error } = await db.rpc("match_notes", {
          query_embedding: embeddingStr,
          match_threshold: 0.5,
          match_count: 10,
          p_user_id: userId,
        });
        if (error) throw error;
        const results = (data || []).map((n: any) => ({
          id: n.id,
          title: n.title,
          content: n.content?.substring(0, 500),
          similarity: n.similarity,
          tags: n.tags,
        }));
        return JSON.stringify({ results, count: results.length });
      } catch {
        // Fallback to ILIKE
        return executeTool("search_notes_text", args, userId, noteId);
      }
    }

    case "search_notes_text": {
      const q = (args.query as string).toLowerCase();
      const { data, error } = await db
        .from("notes")
        .select("id, title, content, tags, metadata")
        .eq("user_id", userId)
        .eq("is_trashed", false)
        .or(`title.ilike.%${q}%,content.ilike.%${q}%`)
        .order("updated_at", { ascending: false })
        .limit(10);
      if (error) return JSON.stringify({ error: error.message });
      const results = (data || []).map((n: any) => ({
        id: n.id,
        title: n.title,
        content: n.content?.substring(0, 500),
        tags: n.tags,
      }));
      return JSON.stringify({ results, count: results.length });
    }

    case "append_to_note": {
      const text = args.text as string;
      // Fetch current content, append, update
      const { data: note } = await db
        .from("notes")
        .select("content")
        .eq("id", noteId)
        .eq("user_id", userId)
        .single();
      if (!note) return JSON.stringify({ error: "Note not found" });
      const newContent = note.content + "\n\n" + text;
      const { error } = await db
        .from("notes")
        .update({ content: newContent })
        .eq("id", noteId)
        .eq("user_id", userId);
      if (error) return JSON.stringify({ error: error.message });
      return JSON.stringify({
        success: true,
        action: "append_to_note",
        appended_text: text,
      });
    }

    case "update_note_metadata": {
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

    case "search_media_text": {
      const q = (args.query as string).toLowerCase();
      const { data, error } = await db
        .from("media_analysis")
        .select("id, note_id, storage_path, media_type, page_number, original_filename, extracted_text, description, topics")
        .eq("user_id", userId)
        .eq("analysis_status", "complete")
        .or(`extracted_text.ilike.%${q}%,description.ilike.%${q}%`)
        .order("created_at", { ascending: false })
        .limit(10);
      if (error) return JSON.stringify({ error: error.message });
      // Also fetch note titles for context
      const noteIds = [...new Set((data || []).map((m: any) => m.note_id))];
      let noteTitles: Record<string, string> = {};
      if (noteIds.length > 0) {
        const { data: notes } = await db
          .from("notes")
          .select("id, title")
          .in("id", noteIds);
        noteTitles = Object.fromEntries((notes || []).map((n: any) => [n.id, n.title]));
      }
      const results = (data || []).map((m: any) => ({
        id: m.id,
        note_id: m.note_id,
        note_title: noteTitles[m.note_id] || "Unknown",
        filename: m.original_filename,
        media_type: m.media_type,
        page_number: m.page_number,
        description: m.description?.substring(0, 300),
        extracted_text: m.extracted_text?.substring(0, 500),
        topics: m.topics,
      }));
      return JSON.stringify({ results, count: results.length });
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
    const { note_id, messages: chatMessages } = body;

    if (!chatMessages || !Array.isArray(chatMessages))
      return json({ error: "messages required" }, 400);

    // Check credits
    const balance = await checkBalance(db, user.id);
    if (!balance.allowed) return insufficientCreditsResponse(corsHeaders);

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
        content: SYSTEM_PROMPT + noteContext,
      };
      activeTools = TOOLS;
    } else {
      // General knowledge base mode — search-only tools
      const GENERAL_SYSTEM_PROMPT = `You are an AI assistant for Menerio (also known as "Open Brain"), a personal knowledge management application. You help the user explore and search their knowledge base.

You have access to tools to:
1. Search the user's notes semantically (vector search) or by text (ILIKE)
2. Search across OCR-extracted text and descriptions from images and PDFs in all notes

Guidelines:
- When the user asks about their notes or knowledge, use search tools to find relevant information
- Use semantic search for conceptual queries, text search for specific names/phrases
- Keep responses concise and helpful
- You can chain multiple search tool calls if needed
- Present search results in a clear, organized way`;

      systemMessage = {
        role: "system",
        content: GENERAL_SYSTEM_PROMPT,
      };

      const SEARCH_TOOL_NAMES = ["search_notes_semantic", "search_notes_text", "search_media_text"];
      activeTools = TOOLS.filter((t) => SEARCH_TOOL_NAMES.includes(t.function.name));
    }

    // Build messages array: system + user conversation
    const llmMessages = [systemMessage, ...chatMessages];

    // Call LLM with tools (agentic loop for tool calls)
    let iterations = 0;
    const MAX_ITERATIONS = 5;
    let lastCredits: any = null;
    const toolResults: any[] = [];

    while (iterations < MAX_ITERATIONS) {
      iterations++;

      let result: any;
      try {
        const llmResult = await openRouterWithCredits(
          db,
          OPENROUTER_API_KEY,
          user.id,
          "note-chat",
          "chat/completions",
          {
            model: "minimax/minimax-m2.7",
            messages: llmMessages,
            tools: activeTools,
          }
        );
        result = llmResult.result;
        lastCredits = llmResult.credits;
      } catch (err: any) {
        if (err.message === "INSUFFICIENT_CREDITS") {
          return insufficientCreditsResponse(corsHeaders);
        }
        throw err;
      }

      const choice = result.choices?.[0];
      if (!choice) break;

      const msg = choice.message;

      // If no tool calls, we're done
      if (!msg.tool_calls || msg.tool_calls.length === 0) {
        return json({
          reply: msg.content || "",
          tool_results: toolResults,
          credits: lastCredits
            ? {
                remaining_tokens: lastCredits.remaining_tokens,
                remaining_credits: lastCredits.remaining_credits,
              }
            : null,
        });
      }

      // Execute tool calls
      llmMessages.push(msg);

      for (const tc of msg.tool_calls) {
        const fnName = tc.function.name;
        let fnArgs: Record<string, unknown>;
        try {
          fnArgs = JSON.parse(tc.function.arguments);
        } catch {
          fnArgs = {};
        }

        const toolOutput = await executeTool(
          fnName,
          fnArgs,
          user.id,
          note_id
        );
        toolResults.push({
          tool: fnName,
          args: fnArgs,
          result: JSON.parse(toolOutput),
        });

        llmMessages.push({
          role: "tool",
          tool_call_id: tc.id,
          content: toolOutput,
        });
      }
    }

    // If we exhausted iterations, return whatever we have
    return json({
      reply:
        "I completed the requested actions. Please check the results above.",
      tool_results: toolResults,
      credits: lastCredits
        ? {
            remaining_tokens: lastCredits.remaining_tokens,
            remaining_credits: lastCredits.remaining_credits,
          }
        : null,
    });
  } catch (err: any) {
    console.error("note-chat error:", err);
    return json({ error: err.message || "Internal error" }, 500);
  }
});
