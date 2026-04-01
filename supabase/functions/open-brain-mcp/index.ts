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

      // Enrich with media
      const noteIds = data.map((t: any) => t.id);
      const mediaMap = await getMediaForNotes(noteIds);
      const results = data.map((t: any, i: number) => formatNote(t, i, t.similarity, mediaMap.get(t.id)));

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
        .eq("user_id", BRAIN_OWNER_USER_ID)
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
        const statusIcon = { open: "⬜", in_progress: "🔄", done: "✅", dismissed: "❌" }[item.status] || "⬜";
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
        .eq("user_id", BRAIN_OWNER_USER_ID)
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
        .eq("user_id", BRAIN_OWNER_USER_ID)
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
        .eq("user_id", BRAIN_OWNER_USER_ID)
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
          .eq("user_id", BRAIN_OWNER_USER_ID)
          .ilike("title", `%${note}%`)
          .limit(1);
        if (!data?.length) return { content: [{ type: "text" as const, text: `No note found matching "${note}".` }] };
        noteId = data[0].id;
      }

      const { data: connections } = await supabase
        .from("note_connections")
        .select("*")
        .eq("user_id", BRAIN_OWNER_USER_ID)
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
          .eq("user_id", BRAIN_OWNER_USER_ID)
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
        .eq("user_id", BRAIN_OWNER_USER_ID);

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
        .eq("user_id", BRAIN_OWNER_USER_ID);

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
    },
  },
  async ({ contact_name, type, summary, action_items }) => {
    try {
      const { data: contacts } = await supabase
        .from("contacts")
        .select("id, name")
        .eq("user_id", BRAIN_OWNER_USER_ID)
        .ilike("name", `%${contact_name}%`)
        .limit(1);

      if (!contacts?.length) {
        return { content: [{ type: "text" as const, text: `No contact found matching "${contact_name}". Create the contact first.` }] };
      }

      const contact = contacts[0] as any;
      const today = new Date().toISOString().split("T")[0];

      const { error: intError } = await supabase.from("contact_interactions").insert({
        contact_id: contact.id,
        user_id: BRAIN_OWNER_USER_ID,
        type,
        summary: summary || null,
        action_items: action_items || [],
        interaction_date: today,
      });

      if (intError) {
        return { content: [{ type: "text" as const, text: `Failed to log: ${intError.message}` }], isError: true };
      }

      await supabase.from("contacts").update({ last_contact_date: today }).eq("id", contact.id);

      let msg = `Logged ${type} with ${contact.name}`;
      if (action_items?.length) msg += ` | ${action_items.length} action item(s)`;
      return { content: [{ type: "text" as const, text: msg }] };
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
