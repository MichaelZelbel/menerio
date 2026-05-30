import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  getEmbeddingWithCredits,
} from "../_shared/llm-credits.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
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

async function ilikeFallback(userId: string, query: string, limit: number, caller: string) {
  const q = query.toLowerCase();
  let qb = supabase
    .from("notes")
    .select(
      "id, title, content, metadata, tags, is_favorite, is_pinned, is_trashed, trashed_at, entity_type, source_app, source_id, source_url, is_external, sync_status, structured_fields, related, created_at, updated_at, ai_visibility"
    )
    .eq("user_id", userId)
    .eq("is_trashed", false)
    .or(`title.ilike.%${q}%,content.ilike.%${q}%`)
    .order("updated_at", { ascending: false })
    .limit(limit);
  if (caller === "mcp") qb = qb.eq("ai_visibility", "visible");
  const { data, error } = await qb;
  if (error) throw error;
  return (data || []).map((n: Record<string, unknown>) => ({
    ...n,
    id: String(n.id),
    similarity: null,
    match_source: "note" as const,
  }));
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);

    // Validate JWT via anon-key client with user's token
    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: authErr } = await userClient.auth.getUser();
    if (authErr || !user) return json({ error: "Unauthorized" }, 401);

    const body = await req.json();
    const query = (body.query || "").trim();
    if (!query) return json({ error: "query required" }, 400);

    const threshold = body.threshold ?? 0.25;
    const limit = Math.min(body.limit ?? 20, 50);
    const scope = body.scope || "all"; // "all" | "notes" | "media"
    const caller = body.caller === "mcp" ? "mcp" : "app"; // "app" (default) sees hidden notes, "mcp" filters them out

    let results: unknown[];
    let mode = "semantic";
    let credits: any = null;

    try {
      // Embedding call with credit deduction
      const embResult = await getEmbeddingWithCredits(
        supabase, OPENROUTER_API_KEY, user.id, "search-semantic", query
      );
      credits = embResult.credits;
      const embeddingStr = `[${embResult.embedding.join(",")}]`;

      const searchNotes = scope !== "media";
      const searchMedia = scope !== "notes";

      // Run searches in parallel: chunk-level RAG + media analysis
      const [chunkResults, mediaResults] = await Promise.all([
        searchNotes
          ? supabase.rpc("match_note_chunks", {
              query_embedding: embeddingStr,
              match_threshold: threshold,
              match_count: Math.max(limit * 3, 30),
              p_user_id: user.id,
            }).then(({ data, error }) => {
              if (error) throw error;
              return (data || []) as Array<{
                chunk_id: string; note_id: string; chunk_index: number;
                heading_path: string | null; content: string; similarity: number;
                note_title: string | null; note_created_at: string;
              }>;
            })
          : Promise.resolve([]),
        searchMedia
          ? supabase.rpc("match_media", {
              query_embedding: embeddingStr,
              match_threshold: threshold,
              match_count: limit,
              p_user_id: user.id,
            }).then(({ data, error }) => {
              if (error) {
                console.warn("match_media failed:", error);
                return [];
              }
              return data || [];
            })
          : Promise.resolve([]),
      ]);

      if (scope === "media") {
        results = (mediaResults as any[]).map((m: any) => ({
          id: m.note_id,
          title: m.note_title,
          content: "",
          metadata: null,
          tags: [],
          similarity: m.similarity,
          match_source: "media",
          media_description: m.description,
          media_storage_path: m.storage_path,
          media_type: m.media_type,
          media_topics: m.topics,
          media_page_number: m.page_number,
          media_filename: m.original_filename,
          created_at: m.created_at,
        }));
      } else {
        // Aggregate chunk hits by note_id (best chunk wins).
        const noteMap = new Map<string, any>();
        for (const c of chunkResults) {
          const existing = noteMap.get(c.note_id);
          if (!existing || c.similarity > existing.similarity) {
            noteMap.set(c.note_id, {
              id: c.note_id,
              title: c.note_title,
              content: "",
              metadata: null,
              tags: [],
              similarity: c.similarity,
              match_source: "note",
              chunk_snippet: c.content.slice(0, 320),
              chunk_heading_path: c.heading_path,
              chunk_index: c.chunk_index,
              created_at: c.note_created_at,
            });
          }
        }

        // Hydrate full note rows for chunk hits.
        const noteIds = Array.from(noteMap.keys());
        if (noteIds.length > 0) {
          let hydrateQ = supabase
            .from("notes")
            .select("id, title, content, metadata, tags, is_favorite, is_pinned, is_trashed, trashed_at, entity_type, source_app, source_id, source_url, is_external, sync_status, structured_fields, related, created_at, updated_at, ai_visibility")
            .in("id", noteIds);
          if (caller === "mcp") hydrateQ = hydrateQ.eq("ai_visibility", "visible");
          const { data: noteRows } = await hydrateQ;
          const hydratedIds = new Set((noteRows || []).map((r: any) => r.id));
          if (caller === "mcp") {
            for (const id of noteIds) if (!hydratedIds.has(id)) noteMap.delete(id);
          }
          for (const row of (noteRows || []) as any[]) {
            const existing = noteMap.get(row.id);
            if (existing) noteMap.set(row.id, { ...row, ...existing, content: row.content, ai_visibility: row.ai_visibility });
          }
        }

        // Merge media hits.
        for (const m of mediaResults as any[]) {
          const noteId = m.note_id;
          const existing = noteMap.get(noteId);
          if (existing) {
            existing.match_source = existing.match_source === "note" ? "both" : "media";
            if (m.similarity > (existing.similarity || 0)) existing.similarity = m.similarity;
            existing.media_description = m.description;
            existing.media_storage_path = m.storage_path;
            existing.media_type = m.media_type;
            existing.media_topics = m.topics;
          } else {
            noteMap.set(noteId, {
              id: noteId,
              title: m.note_title,
              content: "",
              metadata: null,
              tags: [],
              similarity: m.similarity,
              match_source: "media",
              media_description: m.description,
              media_storage_path: m.storage_path,
              media_type: m.media_type,
              media_topics: m.topics,
              media_page_number: m.page_number,
              media_filename: m.original_filename,
              created_at: m.created_at,
            });
          }
        }

        // Always run ILIKE to catch notes without chunks/embeddings yet.
        const textResults = await ilikeFallback(user.id, query, limit, caller);
        for (const t of textResults) {
          if (!noteMap.has(t.id)) noteMap.set(t.id, t);
        }

        results = Array.from(noteMap.values())
          .sort((a, b) => (b.similarity || 0) - (a.similarity || 0))
          .slice(0, limit);
      }
    } catch (embErr: any) {
      if (embErr.message === "INSUFFICIENT_CREDITS" || embErr.message === "NO_ACTIVE_PERIOD") {
        console.log("Falling back to ILIKE search: insufficient credits");
        results = await ilikeFallback(user.id, query, limit, caller);
        mode = "ilike_fallback_no_credits";
      } else {
        console.error("Semantic search failed, falling back to ILIKE:", embErr);
        results = await ilikeFallback(user.id, query, limit, caller);
        mode = "ilike_fallback";
      }
    }

    return json({
      results,
      mode,
      credits: credits ? {
        remaining_tokens: credits.remaining_tokens,
        remaining_credits: credits.remaining_credits,
      } : null,
    });
  } catch (err) {
    console.error("search-notes-semantic error:", err);
    return json({ error: err instanceof Error ? err.message : "An unknown error occurred" }, 500);
  }
});
