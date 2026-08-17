/**
 * Shared read-only tools for the chat agents (note-chat + conversation-chat).
 *
 * These four tools let an agent look things up across the user's brain without
 * mutating anything: semantic note search, text note search, media/OCR search,
 * and structured person-profile lookup. Ported out of note-chat so Mira
 * (conversation-chat) can use the exact same implementations.
 *
 * Read-only by design — the note-mutating tools (append/update/wikilink) stay
 * local to note-chat, which is the only agent with a "current note".
 */
import { openRouterWithCredits } from "./llm-credits.ts";
import { ilikeAnyColumn } from "./postgrest-filters.ts";

const SEMANTIC_EMBED_MODEL = "openai/text-embedding-3-small";

/** OpenAI-style tool schemas for the read tools. */
export const READ_TOOL_SCHEMAS = [
  {
    type: "function",
    function: {
      name: "search_notes_semantic",
      description:
        "Search the user's notes by meaning using vector similarity. Best for conceptual or fuzzy queries.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "The search query to find semantically similar notes" },
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
          query: { type: "string", description: "The text to search for in note titles and content" },
        },
        required: ["query"],
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
          query: { type: "string", description: "The text to search for in media extracted text and descriptions" },
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
          name: { type: "string", description: "The person's name (or nickname/alias) to look up" },
        },
        required: ["name"],
        additionalProperties: false,
      },
    },
  },
];

export const READ_TOOL_NAMES = READ_TOOL_SCHEMAS.map((t) => t.function.name);

/**
 * Load a contact's structured profile (entries + relationships) for the
 * get_person_profile tool and for person-page context injection.
 */
export async function loadPersonProfile(db: any, userId: string, contactId: string) {
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
    const { data: others } = await db.from("contacts").select("id, name").in("id", [...otherIds]);
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

/**
 * Execute one of the read tools. Returns a JSON string for the agent loop.
 * `apiKey` is the OpenRouter key (for the semantic-search embedding).
 */
export async function executeReadTool(
  db: any,
  apiKey: string,
  userId: string,
  name: string,
  args: Record<string, unknown>
): Promise<string> {
  switch (name) {
    case "search_notes_semantic": {
      const query = args.query as string;
      try {
        const embResult = await openRouterWithCredits(
          db,
          apiKey,
          userId,
          "chat:tool:semantic-search",
          "embeddings",
          { model: SEMANTIC_EMBED_MODEL, input: query }
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
        return executeReadTool(db, apiKey, userId, "search_notes_text", args);
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
        .or(ilikeAnyColumn(["title", "content"], q))
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

    case "search_media_text": {
      const q = (args.query as string).toLowerCase();
      const { data, error } = await db
        .from("media_analysis")
        .select("id, note_id, storage_path, media_type, page_number, original_filename, extracted_text, description, topics")
        .eq("user_id", userId)
        .eq("analysis_status", "complete")
        .or(ilikeAnyColumn(["extracted_text", "description"], q))
        .order("created_at", { ascending: false })
        .limit(10);
      if (error) return JSON.stringify({ error: error.message });
      const noteIds = [...new Set((data || []).map((m: any) => m.note_id))];
      let noteTitles: Record<string, string> = {};
      if (noteIds.length > 0) {
        const { data: notes } = await db.from("notes").select("id, title").in("id", noteIds);
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
        return JSON.stringify({ found: false, message: `No person named "${rawName}" in the user's People list.` });
      }
      if (matches.length > 1) {
        return JSON.stringify({
          ambiguous: true,
          candidates: matches.map((m) => ({ id: m.id, name: m.name })),
          hint: "Multiple people matched — call again with a more specific name.",
        });
      }
      const profile = await loadPersonProfile(db, userId, matches[0].id);
      if (!profile) return JSON.stringify({ found: false, message: "Person not found." });
      return JSON.stringify({ found: true, ...profile });
    }

    default:
      return JSON.stringify({ error: `Unknown read tool: ${name}` });
  }
}
