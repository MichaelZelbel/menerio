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
2. Append text to the current note
3. Update note metadata (topics, type, sentiment, people, summary, action_items, dates_mentioned)
4. Update note tags
5. Add wikilinks to connect the current note to other notes

Guidelines:
- When the user asks about their notes or knowledge, use search tools to find relevant information
- Use semantic search for conceptual queries, text search for specific names/phrases
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

    case "add_wikilink": {
      const targetId = args.target_note_id as string;
      const targetTitle = args.target_note_title as string;
      // Create a note_connection
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

    if (!note_id) return json({ error: "note_id required" }, 400);
    if (!chatMessages || !Array.isArray(chatMessages))
      return json({ error: "messages required" }, 400);

    // Check credits
    const balance = await checkBalance(db, user.id);
    if (!balance.allowed) return insufficientCreditsResponse(corsHeaders);

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

    // Build system message with note context
    const noteContext = `\n\n--- CURRENT NOTE ---\nTitle: ${note.title}\nTags: ${(note.tags || []).join(", ") || "none"}\nMetadata: ${JSON.stringify(note.metadata || {})}\nContent:\n${note.content}\n--- END NOTE ---`;

    const systemMessage = {
      role: "system",
      content: SYSTEM_PROMPT + noteContext,
    };

    // Build messages array: system + user conversation
    let llmMessages = [systemMessage, ...chatMessages];

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
            model: "openai/gpt-4o-mini",
            messages: llmMessages,
            tools: TOOLS,
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
