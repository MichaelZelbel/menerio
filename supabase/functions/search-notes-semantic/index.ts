import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  getEmbeddingWithCredits,
  insufficientCreditsResponse,
} from "../_shared/llm-credits.ts";

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

async function ilikeFallback(userId: string, query: string, limit: number) {
  const q = query.toLowerCase();
  const { data, error } = await supabase
    .from("notes")
    .select(
      "id, title, content, metadata, tags, is_favorite, is_pinned, is_trashed, trashed_at, entity_type, source_app, source_id, source_url, is_external, sync_status, structured_fields, related, created_at, updated_at"
    )
    .eq("user_id", userId)
    .eq("is_trashed", false)
    .or(`title.ilike.%${q}%,content.ilike.%${q}%`)
    .order("updated_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data || []).map((n: Record<string, unknown>) => ({
    ...n,
    similarity: null,
  }));
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
    } = await supabase.auth.getUser(token);
    if (authErr || !user) return json({ error: "Unauthorized" }, 401);

    const body = await req.json();
    const query = (body.query || "").trim();
    if (!query) return json({ error: "query required" }, 400);

    const threshold = body.threshold ?? 0.5;
    const limit = Math.min(body.limit ?? 20, 50);

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

      const { data, error } = await supabase.rpc("match_notes", {
        query_embedding: embeddingStr,
        match_threshold: threshold,
        match_count: limit,
        p_user_id: user.id,
      });
      if (error) throw error;
      results = data || [];
    } catch (embErr: any) {
      if (embErr.message === "INSUFFICIENT_CREDITS" || embErr.message === "NO_ACTIVE_PERIOD") {
        // Fall back to ILIKE search when credits are exhausted (graceful degradation)
        console.log("Falling back to ILIKE search: insufficient credits");
        results = await ilikeFallback(user.id, query, limit);
        mode = "ilike_fallback_no_credits";
      } else {
        console.error("Semantic search failed, falling back to ILIKE:", embErr);
        results = await ilikeFallback(user.id, query, limit);
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
    return json({ error: err.message }, 500);
  }
});
