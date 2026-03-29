import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPTransport } from "@hono/mcp";
import { Hono } from "hono";
import { z } from "zod";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const OPENROUTER_API_KEY = Deno.env.get("OPENROUTER_API_KEY")!;
const MCP_ACCESS_KEY = Deno.env.get("MCP_ACCESS_KEY")!;
const BRAIN_OWNER_USER_ID = Deno.env.get("BRAIN_OWNER_USER_ID")!;
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

function formatNote(
  t: { content: string; title?: string; metadata: Record<string, unknown>; created_at: string; id?: string },
  i: number,
  showSimilarity?: number
): string {
  const m = t.metadata || {};
  const parts: string[] = [];
  if (showSimilarity !== undefined) {
    parts.push(`--- Result ${i + 1} (${(showSimilarity * 100).toFixed(1)}% match) ---`);
  } else {
    parts.push(`--- ${i + 1} ---`);
  }
  if (t.title) parts.push(`Title: ${t.title}`);
  parts.push(`Captured: ${new Date(t.created_at).toLocaleDateString()}`);
  parts.push(`Type: ${m.type || "unknown"}`);
  if (Array.isArray(m.topics) && m.topics.length)
    parts.push(`Topics: ${(m.topics as string[]).join(", ")}`);
  if (Array.isArray(m.people) && m.people.length)
    parts.push(`People: ${(m.people as string[]).join(", ")}`);
  if (Array.isArray(m.action_items) && m.action_items.length)
    parts.push(`Actions: ${(m.action_items as string[]).join("; ")}`);
  parts.push(`\n${t.content}`);
  return parts.join("\n");
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
      threshold: z.number().optional().default(0.5),
    },
  },
  async ({ query, limit, threshold }) => {
    try {
      const qEmb = await getEmbedding(query);
      const { data, error } = await supabase.rpc("match_notes", {
        query_embedding: qEmb,
        match_threshold: threshold,
        match_count: limit,
        p_user_id: BRAIN_OWNER_USER_ID,
      });

      if (error) {
        return { content: [{ type: "text" as const, text: `Search error: ${error.message}` }], isError: true };
      }

      if (!data || data.length === 0) {
        return { content: [{ type: "text" as const, text: `No thoughts found matching "${query}".` }] };
      }

      const results = data.map((t: any, i: number) => formatNote(t, i, t.similarity));

      return {
        content: [{ type: "text" as const, text: `Found ${data.length} thought(s):\n\n${results.join("\n\n")}` }],
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
        .eq("user_id", BRAIN_OWNER_USER_ID)
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

      const results = data.map((t: any, i: number) => formatNote(t, i));

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
        user_id: BRAIN_OWNER_USER_ID,
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
        .eq("user_id", BRAIN_OWNER_USER_ID);

      const { data } = await supabase
        .from("notes")
        .select("metadata, created_at")
        .eq("is_trashed", false)
        .eq("user_id", BRAIN_OWNER_USER_ID)
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

// Tool 5: Get Action Items
server.registerTool(
  "get_action_items",
  {
    title: "Get Action Items",
    description: "Return all open action items extracted from notes. Shows which note each action came from and when it was captured.",
    inputSchema: {
      include_completed: z.boolean().optional().default(false).describe("Include completed action items"),
    },
  },
  async ({ include_completed }) => {
    try {
      const { data, error } = await supabase
        .from("notes")
        .select("id, title, content, metadata, created_at")
        .eq("is_trashed", false)
        .eq("user_id", BRAIN_OWNER_USER_ID)
        .order("created_at", { ascending: false });

      if (error) {
        return { content: [{ type: "text" as const, text: `Error: ${error.message}` }], isError: true };
      }

      const items: { action: string; noteTitle: string; date: string; completed: boolean }[] = [];

      for (const note of data || []) {
        const m = (note.metadata || {}) as Record<string, unknown>;
        const completedActions = Array.isArray(m.completed_actions) ? m.completed_actions as string[] : [];

        if (Array.isArray(m.action_items)) {
          for (const action of m.action_items as string[]) {
            const isCompleted = completedActions.includes(action);
            if (!include_completed && isCompleted) continue;
            items.push({
              action,
              noteTitle: note.title || note.content.substring(0, 50),
              date: new Date(note.created_at).toLocaleDateString(),
              completed: isCompleted,
            });
          }
        }
      }

      if (items.length === 0) {
        return { content: [{ type: "text" as const, text: "No open action items found." }] };
      }

      const lines = items.map((item, i) => {
        const check = item.completed ? "✅" : "⬜";
        return `${check} ${i + 1}. ${item.action}\n   From: "${item.noteTitle}" (${item.date})`;
      });

      return {
        content: [{ type: "text" as const, text: `${items.length} action item(s):\n\n${lines.join("\n\n")}` }],
      };
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
          .eq("user_id", BRAIN_OWNER_USER_ID)
          .contains("metadata", { people: [name] })
          .order("created_at", { ascending: false })
          .limit(limit),
        (async () => {
          const emb = await getEmbedding(`notes about ${name}`);
          return supabase.rpc("match_notes", {
            query_embedding: emb,
            match_threshold: 0.5,
            match_count: limit,
            p_user_id: BRAIN_OWNER_USER_ID,
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

// --- Hono App with Auth Check ---
const app = new Hono();

app.all("*", async (c) => {
  const provided = c.req.header("x-brain-key") || new URL(c.req.url).searchParams.get("key");

  if (!provided || provided !== MCP_ACCESS_KEY) {
    return c.json({ error: "Invalid or missing access key" }, 401);
  }

  const transport = new StreamableHTTPTransport();
  await server.connect(transport);
  return transport.handleRequest(c);
});

Deno.serve(app.fetch);
