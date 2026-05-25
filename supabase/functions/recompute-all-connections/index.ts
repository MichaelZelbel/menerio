import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  buildAliasMap,
  resolvePeople,
  intersectSize,
  scoreSharedTopics,
  type Contact,
} from "../_shared/graph-matching.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const OPENROUTER_API_KEY = Deno.env.get("OPENROUTER_API_KEY")!;
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

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

async function getEmbedding(text: string): Promise<number[]> {
  const r = await fetch("https://openrouter.ai/api/v1/embeddings", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENROUTER_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "openai/text-embedding-3-small",
      input: text.slice(0, 8000),
    }),
  });
  if (!r.ok) throw new Error(`Embedding failed: ${r.status}`);
  const d = await r.json();
  return d.data[0].embedding;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  // Restricted to cron / admin tooling that supplies the service role key.
  const authHeader = req.headers.get("Authorization") || "";
  if (!SUPABASE_SERVICE_ROLE_KEY || authHeader !== `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`) {
    return json({ error: "Unauthorized" }, 401);
  }

  try {
    // This runs as a scheduled job, no auth needed — but only callable by cron
    const body = await req.json().catch(() => ({}));
    const batchSize = body.batch_size || 50;
    const minStrength = body.min_strength || 0.65;

    // Get all users who have notes
    const { data: userIds } = await supabase
      .from("notes")
      .select("user_id")
      .eq("is_trashed", false)
      .limit(1000);

    const uniqueUsers = [...new Set((userIds || []).map((r: any) => r.user_id))];
    let totalProcessed = 0;
    let totalConnections = 0;

    for (const userId of uniqueUsers) {
      // Load contacts once per user for alias resolution.
      const { data: userContacts } = await supabase
        .from("contacts")
        .select("id, name, aliases")
        .eq("user_id", userId);
      const aliasMap = buildAliasMap((userContacts || []) as Contact[]);

      // Get all notes for this user
      const { data: notes } = await supabase
        .from("notes")
        .select("id, title, content, metadata, embedding, tags")
        .eq("user_id", userId)
        .eq("is_trashed", false)
        .order("updated_at", { ascending: false })
        .limit(batchSize);

      if (!notes || notes.length === 0) continue;

      for (const note of notes) {
        const meta = (note.metadata || {}) as Record<string, unknown>;
        const people = Array.isArray(meta.people) ? meta.people as string[] : [];
        const topics = Array.isArray(meta.topics) ? meta.topics as string[] : [];
        const myPeopleIds = resolvePeople(people, aliasMap);
        const connections: any[] = [];

        // --- Semantic connections ---
        if (note.embedding) {
          const embedding = typeof note.embedding === "string" ? note.embedding : JSON.stringify(note.embedding);
          const { data: matches } = await supabase.rpc("match_notes", {
            query_embedding: embedding,
            match_threshold: minStrength,
            match_count: 11,
            p_user_id: userId,
          });

          const semanticMatches = (matches || []).filter((m: any) => m.id !== note.id).slice(0, 10);
          for (const m of semanticMatches) {
            connections.push({
              source_note_id: note.id,
              target_note_id: m.id,
              connection_type: "semantic",
              strength: Math.round(m.similarity * 100) / 100,
              metadata: { similarity: m.similarity },
              user_id: userId,
            });
          }

          // Remove stale semantic connections
          const keepIds = new Set(semanticMatches.map((m: any) => m.id));
          const { data: existing } = await supabase
            .from("note_connections")
            .select("id, target_note_id")
            .eq("source_note_id", note.id)
            .eq("connection_type", "semantic")
            .eq("user_id", userId);

          const toDelete = (existing || [])
            .filter((e: any) => !keepIds.has(e.target_note_id))
            .map((e: any) => e.id);

          if (toDelete.length > 0) {
            await supabase.from("note_connections").delete().in("id", toDelete);
          }
        }

        // Fetch other notes once for both person + topic matching.
        const needOthers = people.length > 0 || topics.length > 0;
        const otherNotes = needOthers
          ? (await supabase
              .from("notes")
              .select("id, metadata")
              .eq("user_id", userId)
              .eq("is_trashed", false)
              .neq("id", note.id)
              .limit(1000)).data || []
          : [];

        // --- Shared person connections (alias-aware) ---
        if (myPeopleIds.size > 0) {
          for (const other of otherNotes) {
            const om = (other.metadata || {}) as Record<string, unknown>;
            const op = Array.isArray(om.people) ? om.people as string[] : [];
            const otherIds = resolvePeople(op, aliasMap);
            const sharedCount = intersectSize(myPeopleIds, otherIds);
            if (sharedCount > 0) {
              connections.push({
                source_note_id: note.id,
                target_note_id: other.id,
                connection_type: "shared_person",
                strength: Math.min(1.0, 0.7 + (sharedCount - 1) * 0.1),
                metadata: { shared_person_count: sharedCount },
                user_id: userId,
              });
            }
          }
        }

        // --- Shared topic connections (stopword-aware) ---
        if (topics.length > 0) {
          for (const other of otherNotes) {
            const om = (other.metadata || {}) as Record<string, unknown>;
            const ot = Array.isArray(om.topics) ? om.topics as string[] : [];
            if (ot.length === 0) continue;
            const semanticAbove05 = connections.some(
              (c) => c.target_note_id === other.id && c.connection_type === "semantic" && c.strength > 0.5,
            );
            const result = scoreSharedTopics(topics, ot, semanticAbove05);
            if (result) {
              connections.push({
                source_note_id: note.id,
                target_note_id: other.id,
                connection_type: "shared_topic",
                strength: result.strength,
                metadata: { topics: result.shared },
                user_id: userId,
              });
            }
          }
        }

        // Upsert
        for (const conn of connections) {
          await supabase
            .from("note_connections")
            .upsert(conn, { onConflict: "source_note_id,target_note_id,connection_type" });
          totalConnections++;
        }

        // Clean up stale shared_person and shared_topic
        for (const type of ["shared_person", "shared_topic"]) {
          const keepTargets = new Set(
            connections.filter((c) => c.connection_type === type).map((c) => c.target_note_id)
          );
          const { data: existing } = await supabase
            .from("note_connections")
            .select("id, target_note_id")
            .eq("source_note_id", note.id)
            .eq("connection_type", type)
            .eq("user_id", userId);

          const toDelete = (existing || [])
            .filter((e: any) => !keepTargets.has(e.target_note_id))
            .map((e: any) => e.id);

          if (toDelete.length > 0) {
            await supabase.from("note_connections").delete().in("id", toDelete);
          }
        }

        totalProcessed++;
      }
    }

    return json({
      ok: true,
      users_processed: uniqueUsers.length,
      notes_processed: totalProcessed,
      connections_upserted: totalConnections,
    });
  } catch (err) {
    console.error("recompute-all-connections error:", err);
    return json({ error: err instanceof Error ? err.message : "An unknown error occurred" }, 500);
  }
});
