import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "unauthorized" }, 401);
    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
    if (authErr || !user) return json({ error: "unauthorized" }, 401);

    const body = await req.json().catch(() => ({}));
    const {
      note_id,
      hops = 2,
      limit = 200,
      min_strength = 0,
      connection_types,
      note_type,
      topic,
      person,
    } = body;

    // Neighborhood mode: BFS from a note
    if (note_id) {
      const visited = new Set<string>();
      const queue: { id: string; depth: number }[] = [{ id: note_id, depth: 0 }];
      visited.add(note_id);

      while (queue.length > 0) {
        const current = queue.shift()!;
        if (current.depth >= hops) continue;

        const { data: edges } = await supabase
          .from("note_connections")
          .select("source_note_id, target_note_id")
          .eq("user_id", user.id)
          .gte("strength", min_strength)
          .or(`source_note_id.eq.${current.id},target_note_id.eq.${current.id}`);

        for (const e of edges || []) {
          const neighbor = e.source_note_id === current.id ? e.target_note_id : e.source_note_id;
          if (!visited.has(neighbor)) {
            visited.add(neighbor);
            queue.push({ id: neighbor, depth: current.depth + 1 });
          }
        }
      }

      const noteIds = Array.from(visited);
      if (noteIds.length === 0) return json({ nodes: [], edges: [] });

      // Fetch nodes
      const { data: notes } = await supabase
        .from("notes")
        .select("id, title, metadata, tags, entity_type, created_at")
        .eq("user_id", user.id)
        .eq("is_trashed", false)
        .in("id", noteIds);

      // Fetch edges between these nodes
      const { data: connections } = await supabase
        .from("note_connections")
        .select("id, source_note_id, target_note_id, connection_type, strength, metadata")
        .eq("user_id", user.id)
        .gte("strength", min_strength)
        .in("source_note_id", noteIds)
        .in("target_note_id", noteIds);

      return json({
        nodes: (notes || []).map(n => ({
          id: n.id,
          title: n.title,
          type: (n.metadata as any)?.type || n.entity_type || "note",
          topics: (n.metadata as any)?.topics || [],
          tags: n.tags || [],
          created_at: n.created_at,
        })),
        edges: (connections || []).map(c => ({
          id: c.id,
          source: c.source_note_id,
          target: c.target_note_id,
          type: c.connection_type,
          strength: c.strength,
          metadata: c.metadata,
        })),
      });
    }

    // Full graph mode
    let notesQuery = supabase
      .from("notes")
      .select("id, title, metadata, tags, entity_type, created_at")
      .eq("user_id", user.id)
      .eq("is_trashed", false)
      .order("created_at", { ascending: false })
      .limit(limit);

    if (note_type) {
      notesQuery = notesQuery.eq("entity_type", note_type);
    }

    const { data: notes } = await notesQuery;
    if (!notes || notes.length === 0) return json({ nodes: [], edges: [] });

    // Apply topic/person filters client-side on metadata
    let filteredNotes = notes;
    if (topic) {
      filteredNotes = filteredNotes.filter(n => {
        const t = (n.metadata as any)?.topics;
        return Array.isArray(t) && t.some((tp: string) => tp.toLowerCase().includes(topic.toLowerCase()));
      });
    }
    if (person) {
      filteredNotes = filteredNotes.filter(n => {
        const p = (n.metadata as any)?.people;
        return Array.isArray(p) && p.some((pp: string) => pp.toLowerCase().includes(person.toLowerCase()));
      });
    }

    const noteIds = filteredNotes.map(n => n.id);
    if (noteIds.length === 0) return json({ nodes: [], edges: [] });

    // Fetch connections — batch to avoid query limits
    let allConnections: any[] = [];
    const batchSize = 50;
    for (let i = 0; i < noteIds.length; i += batchSize) {
      const batch = noteIds.slice(i, i + batchSize);
      let connQuery = supabase
        .from("note_connections")
        .select("id, source_note_id, target_note_id, connection_type, strength, metadata")
        .eq("user_id", user.id)
        .gte("strength", min_strength)
        .in("source_note_id", batch)
        .in("target_note_id", noteIds);

      if (connection_types && Array.isArray(connection_types) && connection_types.length > 0) {
        connQuery = connQuery.in("connection_type", connection_types);
      }

      const { data } = await connQuery;
      if (data) allConnections = allConnections.concat(data);
    }

    return json({
      nodes: filteredNotes.map(n => ({
        id: n.id,
        title: n.title,
        type: (n.metadata as any)?.type || n.entity_type || "note",
        topics: (n.metadata as any)?.topics || [],
        tags: n.tags || [],
        created_at: n.created_at,
      })),
      edges: allConnections.map(c => ({
        id: c.id,
        source: c.source_note_id,
        target: c.target_note_id,
        type: c.connection_type,
        strength: c.strength,
        metadata: c.metadata,
      })),
    });
  } catch (err) {
    console.error("get-graph-data error:", err);
    return json({ error: err.message }, 500);
  }
});
