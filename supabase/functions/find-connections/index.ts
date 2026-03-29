import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const OPENROUTER_API_KEY = Deno.env.get("OPENROUTER_API_KEY")!;
const OPENROUTER_BASE = "https://openrouter.ai/api/v1";

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

async function getEmbedding(text: string): Promise<number[]> {
  const r = await fetch(`${OPENROUTER_BASE}/embeddings`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENROUTER_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ model: "openai/text-embedding-3-small", input: text }),
  });
  if (!r.ok) throw new Error(`Embedding failed: ${r.status}`);
  const d = await r.json();
  return d.data[0].embedding;
}

async function generateInsight(context: string): Promise<string> {
  const r = await fetch(`${OPENROUTER_BASE}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENROUTER_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "openai/gpt-4o-mini",
      messages: [
        {
          role: "system",
          content:
            "You are a knowledge analyst. Given a set of related notes, contacts, and action items, write a concise 2-3 sentence insight explaining the non-obvious connections between these items. Focus on cross-domain patterns, time-bridging connections, and actionable observations. Be specific, not generic.",
        },
        { role: "user", content: context },
      ],
    }),
  });
  const d = await r.json();
  return d.choices?.[0]?.message?.content || "No insight could be generated.";
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Authenticate
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "unauthorized" }, 401);
    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
    if (authErr || !user) return json({ error: "unauthorized" }, 401);

    const body = await req.json();
    const { note_id, topic, mode } = body;
    // mode: "connections" (default) or "daily" (for today's connections widget)

    let embedding: number[] | null = null;
    let sourceNote: { id: string; title: string; content: string; metadata: Record<string, unknown> } | null = null;

    if (note_id) {
      // Get the note's embedding
      const { data: note } = await supabase
        .from("notes")
        .select("id, title, content, metadata, embedding")
        .eq("id", note_id)
        .eq("user_id", user.id)
        .single();

      if (!note) return json({ error: "Note not found" }, 404);
      sourceNote = note;

      if (note.embedding) {
        embedding = JSON.parse(note.embedding);
      } else {
        embedding = await getEmbedding(note.content || note.title);
      }
    } else if (topic) {
      embedding = await getEmbedding(topic);
    } else if (mode === "daily") {
      // For daily connections, use the most recent note
      const { data: recentNotes } = await supabase
        .from("notes")
        .select("id, title, content, metadata, embedding")
        .eq("user_id", user.id)
        .eq("is_trashed", false)
        .order("created_at", { ascending: false })
        .limit(3);

      if (!recentNotes || recentNotes.length < 2) {
        return json({ connections: [], insight: null, message: "Need more notes for daily connections." });
      }

      // Use the most recent note as the anchor
      sourceNote = recentNotes[0];
      if (recentNotes[0].embedding) {
        embedding = JSON.parse(recentNotes[0].embedding);
      } else {
        embedding = await getEmbedding(recentNotes[0].content || recentNotes[0].title);
      }
    } else {
      return json({ error: "Provide note_id, topic, or mode=daily" }, 400);
    }

    if (!embedding) return json({ error: "Could not generate embedding" }, 500);

    // Semantic search for related notes
    const { data: relatedNotes } = await supabase.rpc("match_notes", {
      query_embedding: JSON.stringify(embedding),
      match_threshold: 0.3,
      match_count: 10,
      p_user_id: user.id,
    });

    // Filter out the source note itself
    const filtered = (relatedNotes || []).filter(
      (n: { id: string }) => !sourceNote || n.id !== sourceNote.id
    );

    // Cross-reference: find contacts mentioned in related notes
    const allPeople = new Set<string>();
    for (const n of filtered) {
      const meta = n.metadata as Record<string, unknown> | null;
      if (meta && Array.isArray(meta.people)) {
        meta.people.forEach((p: string) => allPeople.add(p.toLowerCase()));
      }
    }
    if (sourceNote) {
      const meta = sourceNote.metadata as Record<string, unknown> | null;
      if (meta && Array.isArray(meta.people)) {
        meta.people.forEach((p: string) => allPeople.add(p.toLowerCase()));
      }
    }

    // Find matching contacts
    let relatedContacts: { id: string; name: string; relationship: string | null }[] = [];
    if (allPeople.size > 0) {
      const { data: contacts } = await supabase
        .from("contacts")
        .select("id, name, relationship")
        .eq("user_id", user.id);

      relatedContacts = (contacts || []).filter((c) =>
        allPeople.has(c.name.toLowerCase())
      );
    }

    // Find action items from related notes
    const relatedNoteIds = filtered.map((n: { id: string }) => n.id);
    let relatedActions: { id: string; content: string; status: string; source_note_id: string | null }[] = [];
    if (relatedNoteIds.length > 0) {
      const { data: actions } = await supabase
        .from("action_items")
        .select("id, content, status, source_note_id")
        .eq("user_id", user.id)
        .in("source_note_id", relatedNoteIds)
        .limit(10);
      relatedActions = actions || [];
    }

    // Generate AI insight
    const insightContext = [
      sourceNote ? `Source note: "${sourceNote.title}" — ${sourceNote.content?.slice(0, 200)}` : "",
      `Related notes (${filtered.length}):`,
      ...filtered.slice(0, 5).map((n: { title: string; similarity: number }) =>
        `- "${n.title}" (similarity: ${(n.similarity * 100).toFixed(0)}%)`
      ),
      relatedContacts.length > 0
        ? `Related people: ${relatedContacts.map((c) => c.name).join(", ")}`
        : "",
      relatedActions.length > 0
        ? `Related action items: ${relatedActions.map((a) => a.content).join("; ")}`
        : "",
    ].filter(Boolean).join("\n");

    const insight = filtered.length > 0 ? await generateInsight(insightContext) : null;

    return json({
      connections: filtered.map((n: { id: string; title: string; similarity: number; metadata: unknown; created_at: string }) => ({
        id: n.id,
        title: n.title,
        similarity: n.similarity,
        metadata: n.metadata,
        created_at: n.created_at,
      })),
      related_contacts: relatedContacts,
      related_actions: relatedActions,
      insight,
      source_note: sourceNote ? { id: sourceNote.id, title: sourceNote.title } : null,
    });
  } catch (err) {
    console.error("find-connections error:", err);
    return json({ error: err.message }, 500);
  }
});
