// Semantic search over a person's long-term documents.
//
// NOTE: as of 2026-08-17 nothing in this repository invokes this function. It is
// kept correct rather than deleted so that whoever wires it up next gets real
// retrieval, not the fabricated vectors it used to produce.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getEmbeddingWithCredits, isBalanceUnavailable } from "../_shared/llm-credits.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const { query, personId } = await req.json();
    if (!query || typeof query !== "string" || !personId || typeof personId !== "string") return json({ error: "query and personId required" }, 400);

    const authHeader = req.headers.get("authorization");
    if (!authHeader?.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);

    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: { user }, error: userError } = await supabase.auth.getUser(authHeader.replace("Bearer ", ""));
    if (userError || !user) return json({ error: "Unauthorized" }, 401);

    const openRouterKey = Deno.env.get("OPENROUTER_API_KEY");
    if (!openRouterKey) throw new Error("OPENROUTER_API_KEY not configured");

    const { embedding: queryEmbedding } = await getEmbeddingWithCredits(
      supabase,
      openRouterKey,
      user.id,
      "search-documents",
      query.slice(0, 8000),
    );

    const { data, error } = await supabase.rpc("match_person_documents", {
      query_embedding: JSON.stringify(queryEmbedding),
      match_person_id: personId,
      match_user_id: user.id,
      match_threshold: 0.3,
      match_count: 5,
    });
    if (error) throw error;
    return json({ documents: data || [] });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    if (isBalanceUnavailable(error)) {
      console.error("search-documents: allowance unreadable:", error);
      return json({ error: "Could not verify your AI credit balance.", code: "BALANCE_UNAVAILABLE" }, 503);
    }
    if (message === "INSUFFICIENT_CREDITS" || message === "NO_ACTIVE_PERIOD") {
      return json({ error: "Insufficient AI credits", code: "INSUFFICIENT_CREDITS" }, 402);
    }
    console.error("search-documents error:", error);
    return json({ error: message }, 500);
  }
});
