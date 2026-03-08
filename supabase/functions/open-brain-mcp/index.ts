import { Hono } from "hono";
import { McpServer, StreamableHttpTransport } from "mcp-lite";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const OPENROUTER_API_KEY = Deno.env.get("OPENROUTER_API_KEY")!;
const OPENROUTER_BASE = "https://openrouter.ai/api/v1";

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

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
  if (!r.ok) throw new Error(`Embedding failed: ${r.status}`);
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
          content: `Extract metadata from the user's note. Return JSON with:
- "topics": array of 1-3 short topic tags
- "type": one of "observation", "task", "idea", "reference", "person_note", "meeting", "journal"
- "summary": one-sentence summary
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

// Helper: resolve user_id from MCP auth header or param
async function resolveUserId(userId?: string): Promise<string | null> {
  // For now, user_id must be provided as a parameter
  // In production, this would come from an API key → user mapping
  return userId || null;
}

const app = new Hono();

const mcpServer = new McpServer({
  name: "open-brain",
  version: "1.0.0",
});

// Tool 1: search_thoughts — semantic search
mcpServer.tool({
  name: "search_thoughts",
  description: "Semantically search your brain for relevant thoughts, notes, and ideas. Returns the most similar notes to your query.",
  inputSchema: {
    type: "object",
    properties: {
      query: { type: "string", description: "Natural language search query" },
      user_id: { type: "string", description: "User ID to search notes for" },
      limit: { type: "number", description: "Max results (default 10)" },
      threshold: { type: "number", description: "Similarity threshold 0-1 (default 0.7)" },
    },
    required: ["query", "user_id"],
  },
  handler: async ({ query, user_id, limit, threshold }) => {
    const uid = await resolveUserId(user_id);
    if (!uid) return { content: [{ type: "text", text: "Error: user_id is required" }] };

    const embedding = await getEmbedding(query);

    const { data, error } = await supabase.rpc("match_notes", {
      query_embedding: JSON.stringify(embedding),
      match_threshold: threshold ?? 0.7,
      match_count: limit ?? 10,
      p_user_id: uid,
    });

    if (error) return { content: [{ type: "text", text: `Error: ${error.message}` }] };

    if (!data || data.length === 0) {
      return { content: [{ type: "text", text: "No matching thoughts found." }] };
    }

    const results = data.map((n: any, i: number) =>
      `${i + 1}. **${n.title}** (similarity: ${(n.similarity * 100).toFixed(1)}%)\n   Tags: ${n.tags?.join(", ") || "none"}\n   ${n.content.substring(0, 200)}${n.content.length > 200 ? "..." : ""}`
    ).join("\n\n");

    return { content: [{ type: "text", text: `Found ${data.length} thoughts:\n\n${results}` }] };
  },
});

// Tool 2: list_thoughts — list recent notes
mcpServer.tool({
  name: "list_thoughts",
  description: "List recent thoughts/notes, optionally filtered by tag or type.",
  inputSchema: {
    type: "object",
    properties: {
      user_id: { type: "string", description: "User ID" },
      limit: { type: "number", description: "Max results (default 20)" },
      tag: { type: "string", description: "Filter by tag" },
      type: { type: "string", description: "Filter by type (observation, task, idea, reference, person_note, meeting, journal)" },
    },
    required: ["user_id"],
  },
  handler: async ({ user_id, limit, tag, type }) => {
    const uid = await resolveUserId(user_id);
    if (!uid) return { content: [{ type: "text", text: "Error: user_id is required" }] };

    let query = supabase
      .from("notes")
      .select("id, title, content, tags, metadata, created_at, updated_at")
      .eq("user_id", uid)
      .eq("is_trashed", false)
      .order("updated_at", { ascending: false })
      .limit(limit ?? 20);

    if (tag) {
      query = query.contains("tags", [tag]);
    }

    const { data, error } = await query;
    if (error) return { content: [{ type: "text", text: `Error: ${error.message}` }] };

    let notes = data || [];

    // Filter by type from metadata if requested
    if (type) {
      notes = notes.filter((n: any) => (n.metadata as any)?.type === type);
    }

    if (notes.length === 0) {
      return { content: [{ type: "text", text: "No thoughts found." }] };
    }

    const results = notes.map((n: any, i: number) => {
      const meta = n.metadata as any;
      return `${i + 1}. **${n.title}** [${meta?.type || "unknown"}]\n   Tags: ${n.tags?.join(", ") || "none"}\n   Created: ${n.created_at}\n   ${n.content.substring(0, 150)}${n.content.length > 150 ? "..." : ""}`;
    }).join("\n\n");

    return { content: [{ type: "text", text: `${notes.length} thoughts:\n\n${results}` }] };
  },
});

// Tool 3: thought_stats — aggregate stats
mcpServer.tool({
  name: "thought_stats",
  description: "Get statistics about your brain: total thoughts, breakdown by type, top tags, recent activity.",
  inputSchema: {
    type: "object",
    properties: {
      user_id: { type: "string", description: "User ID" },
    },
    required: ["user_id"],
  },
  handler: async ({ user_id }) => {
    const uid = await resolveUserId(user_id);
    if (!uid) return { content: [{ type: "text", text: "Error: user_id is required" }] };

    const { data, error } = await supabase
      .from("notes")
      .select("id, tags, metadata, created_at, is_favorite, is_pinned")
      .eq("user_id", uid)
      .eq("is_trashed", false);

    if (error) return { content: [{ type: "text", text: `Error: ${error.message}` }] };

    const notes = data || [];
    const total = notes.length;
    const favorites = notes.filter((n: any) => n.is_favorite).length;
    const pinned = notes.filter((n: any) => n.is_pinned).length;

    // Type breakdown
    const typeCounts: Record<string, number> = {};
    notes.forEach((n: any) => {
      const t = (n.metadata as any)?.type || "unprocessed";
      typeCounts[t] = (typeCounts[t] || 0) + 1;
    });

    // Tag frequency
    const tagCounts: Record<string, number> = {};
    notes.forEach((n: any) => {
      (n.tags || []).forEach((tag: string) => {
        tagCounts[tag] = (tagCounts[tag] || 0) + 1;
      });
    });
    const topTags = Object.entries(tagCounts)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 10)
      .map(([tag, count]) => `${tag} (${count})`)
      .join(", ");

    // Recent activity (last 7 days)
    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const recentCount = notes.filter((n: any) => n.created_at > weekAgo).length;

    const typeBreakdown = Object.entries(typeCounts)
      .map(([t, c]) => `  ${t}: ${c}`)
      .join("\n");

    const stats = `📊 **Brain Stats**
Total thoughts: ${total}
Favorites: ${favorites} | Pinned: ${pinned}
Created this week: ${recentCount}

**By type:**
${typeBreakdown}

**Top tags:** ${topTags || "none"}`;

    return { content: [{ type: "text", text: stats }] };
  },
});

// Tool 4: capture_thought — create a new note
mcpServer.tool({
  name: "capture_thought",
  description: "Capture a new thought/note into your brain. Automatically generates embedding and extracts metadata.",
  inputSchema: {
    type: "object",
    properties: {
      text: { type: "string", description: "The thought or note content" },
      user_id: { type: "string", description: "User ID" },
      title: { type: "string", description: "Optional title (auto-generated if omitted)" },
      tags: {
        type: "array",
        items: { type: "string" },
        description: "Optional tags",
      },
    },
    required: ["text", "user_id"],
  },
  handler: async ({ text, user_id, title, tags }) => {
    const uid = await resolveUserId(user_id);
    if (!uid) return { content: [{ type: "text", text: "Error: user_id is required" }] };

    const content = text.trim();
    const noteTitle = title || content.split("\n")[0].substring(0, 80) || "Untitled thought";

    // Generate embedding and metadata in parallel
    const [embedding, metadata] = await Promise.all([
      getEmbedding(content),
      extractMetadata(content),
    ]);

    const enrichedMetadata = {
      ...metadata,
      source: "mcp",
      ingested_at: new Date().toISOString(),
    };

    const noteTags = tags || (metadata as any).topics || [];

    const { data: note, error } = await supabase
      .from("notes")
      .insert({
        user_id: uid,
        title: noteTitle,
        content,
        embedding,
        metadata: enrichedMetadata,
        tags: noteTags,
      })
      .select("id, title, created_at")
      .single();

    if (error) return { content: [{ type: "text", text: `Error: ${error.message}` }] };

    return {
      content: [{
        type: "text",
        text: `✅ Captured: **${note.title}** (id: ${note.id})\nType: ${(metadata as any).type || "unknown"}\nTags: ${noteTags.join(", ") || "none"}`,
      }],
    };
  },
});

const transport = new StreamableHttpTransport();

app.all("/*", async (c) => {
  return await transport.handleRequest(c.req.raw, mcpServer);
});

Deno.serve(app.fetch);
