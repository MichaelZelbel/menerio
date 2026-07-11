import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  checkBalance,
  openRouterWithCredits,
  insufficientCreditsResponse,
} from "../_shared/llm-credits.ts";
import { resolveSystemPrompt } from "../_shared/llm-router.ts";
import {
  NOTE_CHAT_NOTE_MODE_PROMPT,
  NOTE_CHAT_GENERAL_MODE_PROMPT,
  NOTE_CHAT_SUMMARIZE_PROMPT,
} from "../_shared/llm-defaults.ts";

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
      name: "get_person_profile",
      description:
        "Look up a person from the user's People list by name and return their full profile: attribute entries (label/value by category), relationships, and aliases. Use this FIRST for any question about a specific person or their profile data — profiles are structured data that note search cannot see.",
      parameters: {
        type: "object",
        properties: {
          name: {
            type: "string",
            description: "The person's name (or nickname/alias) to look up",
          },
        },
        required: ["name"],
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

// System prompts now resolved at runtime from llm_call_configs
// (call_sites: "note-chat.main" with {{noteContext}}, "note-chat.general", "note-chat.summarize").
// Falls back to constants in llm-defaults.ts.

// Load a contact's structured profile (entries + relationships) for the
// get_person_profile tool and for person-page context injection.
async function loadPersonProfile(userId: string, contactId: string) {
  const { data: contact } = await db
    .from("contacts")
    .select("id, name, aliases")
    .eq("id", contactId)
    .eq("user_id", userId)
    .is("merged_into", null)
    .maybeSingle();
  if (!contact) return null;

  const { data: entries } = await db
    .from("profile_entries")
    .select("label, value, profile_categories(name, slug)")
    .eq("user_id", userId)
    .eq("contact_id", contactId)
    .limit(100);

  const { data: rels } = await db
    .from("contact_relationships")
    .select("source_type, source_id, target_type, target_id, label")
    .eq("user_id", userId)
    .or(`source_id.eq.${contactId},target_id.eq.${contactId}`);

  const otherIds = new Set<string>();
  for (const r of (rels || []) as any[]) {
    if (r.source_type === "contact" && r.source_id && r.source_id !== contactId) otherIds.add(r.source_id);
    if (r.target_type === "contact" && r.target_id && r.target_id !== contactId) otherIds.add(r.target_id);
  }
  let names: Record<string, string> = {};
  if (otherIds.size > 0) {
    const { data: others } = await db
      .from("contacts")
      .select("id, name")
      .in("id", [...otherIds]);
    names = Object.fromEntries((others || []).map((c: any) => [c.id, c.name]));
  }
  const describe = (type: string, id: string | null) =>
    type === "self" ? "the user" : id === contactId ? contact.name : names[id || ""] || "unknown";

  return {
    person: { id: contact.id, name: contact.name, aliases: (contact.aliases || []) as string[] },
    profile_entries: ((entries || []) as any[]).map((e: any) => ({
      category: e.profile_categories?.name || e.profile_categories?.slug || "other",
      label: e.label,
      value: e.value,
    })),
    relationships: ((rels || []) as any[]).map((r: any) => ({
      from: describe(r.source_type, r.source_id),
      label: r.label,
      to: describe(r.target_type, r.target_id),
    })),
  };
}

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
        const { data, error } = await db.rpc("match_note_chunks", {
          query_embedding: embeddingStr,
          match_threshold: 0.5,
          match_count: 30,
          p_user_id: userId,
        });
        if (error) throw error;
        // Aggregate chunk hits by note (best-chunk wins).
        const byNote = new Map<string, any>();
        for (const c of (data || []) as any[]) {
          const ex = byNote.get(c.note_id);
          if (!ex || c.similarity > ex.similarity) {
            byNote.set(c.note_id, {
              id: c.note_id,
              title: c.note_title,
              content: String(c.content || "").slice(0, 500),
              similarity: c.similarity,
              chunk_heading_path: c.heading_path,
            });
          }
        }
        // Filter out AI-hidden notes
        const candidateIds = Array.from(byNote.keys());
        if (candidateIds.length > 0) {
          const { data: visible } = await db
            .from("notes")
            .select("id")
            .in("id", candidateIds)
            .eq("ai_visibility", "visible");
          const visibleSet = new Set((visible || []).map((n: any) => n.id));
          for (const id of candidateIds) {
            if (!visibleSet.has(id)) byNote.delete(id);
          }
        }
        const results = Array.from(byNote.values()).slice(0, 10);
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
        .eq("ai_visibility", "visible")
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

    case "get_person_profile": {
      const rawName = String(args.name || "").trim();
      if (!rawName) return JSON.stringify({ error: "name required" });
      const q = rawName.toLowerCase();
      let matches: any[] = [];
      const { data: byName } = await db
        .from("contacts")
        .select("id, name, aliases")
        .eq("user_id", userId)
        .is("merged_into", null)
        .ilike("name", `%${q}%`)
        .limit(5);
      matches = byName || [];
      if (matches.length === 0) {
        // Fall back to alias matching (aliases is an array column, so filter in JS).
        const { data: all } = await db
          .from("contacts")
          .select("id, name, aliases")
          .eq("user_id", userId)
          .is("merged_into", null)
          .limit(500);
        matches = ((all || []) as any[])
          .filter((c) => (c.aliases || []).some((a: string) => String(a).toLowerCase().includes(q)))
          .slice(0, 5);
      }
      if (matches.length === 0) {
        return JSON.stringify({
          found: false,
          message: `No person named "${rawName}" in the user's People list.`,
        });
      }
      if (matches.length > 1) {
        return JSON.stringify({
          ambiguous: true,
          candidates: matches.map((m) => ({ id: m.id, name: m.name })),
          hint: "Multiple people matched — call again with a more specific name.",
        });
      }
      const profile = await loadPersonProfile(userId, matches[0].id);
      if (!profile) return JSON.stringify({ found: false, message: "Person not found." });
      return JSON.stringify({ found: true, ...profile });
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
    const { note_id, person_id, messages: chatMessages, mode } = body;

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
        const sumResult = await openRouterWithCredits(
          db,
          OPENROUTER_API_KEY,
          user.id,
          "note-chat:summarize",
          "chat/completions",
          {
            model: "deepseek/deepseek-v4-flash",
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
        const p = await loadPersonProfile(user.id, person_id);
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

      const READ_TOOL_NAMES = [
        "search_notes_semantic",
        "search_notes_text",
        "search_media_text",
        "get_person_profile",
      ];
      activeTools = TOOLS.filter((t) => READ_TOOL_NAMES.includes(t.function.name));
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

    // Iteration budget exhausted while the model still wanted more tool calls.
    // Never return a canned "actions completed" line — the user likely asked a
    // question. Force one final text answer synthesized from what was gathered.
    try {
      const synthResult = await openRouterWithCredits(
        db,
        OPENROUTER_API_KEY,
        user.id,
        "note-chat",
        "chat/completions",
        {
          model: "minimax/minimax-m2.7",
          messages: [
            ...llmMessages,
            {
              role: "system",
              content:
                "Tool budget exhausted — you cannot call more tools. Using everything gathered above, answer the user's last message directly now. If the gathered results don't contain the answer, say so plainly and suggest what to try instead. Do not claim to have completed any actions.",
            },
          ],
          tools: activeTools,
          tool_choice: "none",
        }
      );
      lastCredits = synthResult.credits ?? lastCredits;
      const synthReply = synthResult.result.choices?.[0]?.message?.content?.trim();
      if (synthReply) {
        return json({
          reply: synthReply,
          tool_results: toolResults,
          credits: lastCredits
            ? {
                remaining_tokens: lastCredits.remaining_tokens,
                remaining_credits: lastCredits.remaining_credits,
              }
            : null,
        });
      }
    } catch (err: any) {
      if (err.message === "INSUFFICIENT_CREDITS") {
        return insufficientCreditsResponse(corsHeaders);
      }
      console.error("note-chat synthesis error:", err);
    }

    return json({
      reply:
        "I couldn't finish researching that within my step budget. Try rephrasing, or point me at a specific note or person to look at.",
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
