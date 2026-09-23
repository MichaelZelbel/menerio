import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  buildAliasMap,
  computeSharedPersons,
  scoreSharedTopics,
  type Contact,
} from "../_shared/graph-matching.ts";

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
    const token = authHeader.replace("Bearer ", "").trim();

    const { note_id } = await req.json();
    if (!note_id) return json({ error: "note_id required" }, 400);

    // Two callers, two credentials.
    //
    // A person saving a note arrives with a user JWT. But process-note fans out
    // to here with whatever Authorization it was itself called with, and both
    // sweep-note-processing and the post-OCR re-trigger in analyze-media call
    // process-note with the SERVICE ROLE KEY. A service-role key is not a user
    // JWT, so getUser() rejected it and this answered 401 — and because the
    // fan-out is a bare fetch().catch(), an HTTP 401 resolves normally and
    // nothing was ever logged. Every note the sweep rescued silently got no
    // connections, which is exactly the set most likely to need them.
    //
    // The internal branch takes the owner from the note row rather than from
    // the request body, so it cannot be pointed at another user's note.
    let userId: string;
    if (token === Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")) {
      const { data: owner } = await supabase
        .from("notes")
        .select("user_id")
        .eq("id", note_id)
        .single();
      if (!owner) return json({ error: "Note not found" }, 404);
      userId = owner.user_id;
    } else {
      const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
      if (authErr || !user) return json({ error: "unauthorized" }, 401);
      userId = user.id;
    }

    // Fetch the note
    const { data: note, error: noteErr } = await supabase
      .from("notes")
      // No content or tags: neither is read here, and content is the note's
      // whole body, loaded after every processed note.
      .select("id, user_id, title, metadata, embedding, ai_visibility")
      .eq("id", note_id)
      .eq("user_id", userId)
      .single();

    if (noteErr || !note) return json({ error: "Note not found" }, 404);

    // Skip connection computation entirely for AI-hidden notes — they must not
    // appear in the Knowledge Graph or generate suggested connections.
    if ((note as any).ai_visibility === "hidden") {
      return json({ ok: true, skipped: "ai_hidden" });
    }

    const meta = (note.metadata || {}) as Record<string, unknown>;
    const people = Array.isArray(meta.people) ? meta.people as string[] : [];
    const topics = Array.isArray(meta.topics) ? meta.topics as string[] : [];

    // Load contacts for alias resolution.
    const { data: contacts } = await supabase
      .from("contacts")
      .select("id, name, aliases")
      .eq("user_id", userId);
    const myTitle = note.title || "";
    const aliasMap = buildAliasMap((contacts || []) as Contact[]);

    const connections: {
      source_note_id: string;
      target_note_id: string;
      connection_type: string;
      strength: number;
      metadata: Record<string, unknown>;
      user_id: string;
    }[] = [];

    // --- Semantic connections ---
    if (note.embedding) {
      const embedding = typeof note.embedding === "string" ? note.embedding : JSON.stringify(note.embedding);
      const { data: matches, error: matchError } = await supabase.rpc("match_notes", {
        query_embedding: embedding,
        match_threshold: 0.65,
        match_count: 11,
        p_user_id: userId,
      });
      // A failed match read as "no matches" made an empty keep-set below and
      // deleted every semantic connection of the note (fixed the same way in
      // recompute-all-connections on 2026-09-16).
      if (matchError) throw new Error(`match_notes failed: ${matchError.message}`);

      const semanticMatches = (matches || []).filter((m: { id: string }) => m.id !== note_id).slice(0, 10);

      for (const m of semanticMatches) {
        connections.push({
          source_note_id: note_id,
          target_note_id: m.id,
          connection_type: "semantic",
          strength: Math.round(m.similarity * 100) / 100,
          metadata: { similarity: m.similarity },
          user_id: userId,
        });
      }

      // Clean up old semantic connections no longer in top 10
      const keepIds = new Set(semanticMatches.map((m: { id: string }) => m.id));
      const { data: existing } = await supabase
        .from("note_connections")
        .select("id, target_note_id")
        .eq("source_note_id", note_id)
        .eq("connection_type", "semantic")
        .eq("user_id", userId);

      const toDelete = (existing || [])
        .filter((e: { target_note_id: string }) => !keepIds.has(e.target_note_id))
        .map((e: { id: string }) => e.id);

      if (toDelete.length > 0) {
        await supabase.from("note_connections").delete().in("id", toDelete);
      }
    }

    // Fetch other notes once for both person + topic matching.
    const needOthers = people.length > 0 || topics.length > 0;
    let otherNotes: Array<{ id: string; title: string | null; metadata: unknown }> = [];
    if (needOthers) {
      const { data, error: othersError } = await supabase
        .from("notes")
        .select("id, title, metadata")
        .eq("user_id", userId)
        .eq("is_trashed", false)
        .eq("ai_visibility", "visible")
        .neq("id", note_id)
        .limit(1000);
      // Same reason: an empty list would delete every shared_person and
      // shared_topic edge of the note in the stale cleanup below.
      if (othersError) throw new Error(`notes read failed: ${othersError.message}`);
      otherNotes = data || [];
    }

    // --- Shared person connections (alias-aware, incidental-aware) ---
    if (people.length > 0) {
      for (const other of otherNotes) {
        const otherMeta = (other.metadata || {}) as Record<string, unknown>;
        const otherPeople = Array.isArray(otherMeta.people) ? otherMeta.people as string[] : [];
        if (otherPeople.length === 0) continue;
        const result = computeSharedPersons(people, myTitle, otherPeople, other.title || "", aliasMap);
        if (result) {
          connections.push({
            source_note_id: note_id,
            target_note_id: other.id,
            connection_type: "shared_person",
            strength: result.strength,
            metadata: {
              shared_person_count: result.sharedIds.length,
              shared_person_ids: result.sharedIds,
            },
            user_id: userId,
          });
        }
      }
    }

    // --- Shared topic connections (stopword-aware) ---
    if (topics.length > 0) {
      for (const other of otherNotes) {
        const otherMeta = (other.metadata || {}) as Record<string, unknown>;
        const otherTopics = Array.isArray(otherMeta.topics) ? otherMeta.topics as string[] : [];
        if (otherTopics.length === 0) continue;
        const semanticAbove05 = connections.some(
          (c) => c.target_note_id === other.id && c.connection_type === "semantic" && c.strength > 0.5,
        );
        const result = scoreSharedTopics(topics, otherTopics, semanticAbove05);
        if (result) {
          connections.push({
            source_note_id: note_id,
            target_note_id: other.id,
            connection_type: "shared_topic",
            strength: result.strength,
            metadata: { topics: result.shared },
            user_id: userId,
          });
        }
      }
    }

    // Upsert all connections (excluding manual_link which are managed separately)
    // In batches. One request per edge meant hundreds of sequential round
    // trips for a note that shares a common topic or person with hundreds of
    // others (shared edges are uncapped), after every processed note. Rows in
    // one batch never collide: each target appears once per connection type.
    // A refused batch (say a target note deleted meanwhile) falls back to one
    // row at a time, so one bad row costs only itself, as before.
    let upserted = 0;
    const UPSERT_BATCH = 500;
    for (let i = 0; i < connections.length; i += UPSERT_BATCH) {
      const batch = connections.slice(i, i + UPSERT_BATCH);
      const { error: batchError } = await supabase
        .from("note_connections")
        .upsert(batch, { onConflict: "source_note_id,target_note_id,connection_type" });
      if (!batchError) {
        upserted += batch.length;
        continue;
      }
      for (const conn of batch) {
        const { error } = await supabase
          .from("note_connections")
          .upsert(conn, { onConflict: "source_note_id,target_note_id,connection_type" });
        if (!error) upserted++;
      }
    }

    // Clean up stale shared_person and shared_topic connections
    for (const type of ["shared_person", "shared_topic"]) {
      const keepTargets = new Set(
        connections.filter(c => c.connection_type === type).map(c => c.target_note_id)
      );
      const { data: existing } = await supabase
        .from("note_connections")
        .select("id, target_note_id")
        .eq("source_note_id", note_id)
        .eq("connection_type", type)
        .eq("user_id", userId);

      const toDelete = (existing || [])
        .filter((e: { target_note_id: string }) => !keepTargets.has(e.target_note_id))
        .map((e: { id: string }) => e.id);

      if (toDelete.length > 0) {
        await supabase.from("note_connections").delete().in("id", toDelete);
      }
    }

    return json({ ok: true, connections_upserted: upserted });
  } catch (err) {
    console.error("compute-connections error:", err);
    return json({ error: err instanceof Error ? err.message : "An unknown error occurred" }, 500);
  }
});
