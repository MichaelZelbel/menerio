import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getEmbeddingWithCredits, isBalanceUnavailable } from "../_shared/llm-credits.ts";

/**
 * text-embedding-3-small accepts 8191 tokens. Characters are a cheap, safe proxy:
 * this cap sits well inside the limit for every script we store.
 */
const MAX_EMBED_CHARS = 8000;

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
    const { documentId } = await req.json();
    if (!documentId || typeof documentId !== "string") return json({ error: "documentId required" }, 400);

    const authHeader = req.headers.get("authorization");
    if (!authHeader?.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);

    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: { user }, error: userError } = await supabase.auth.getUser(authHeader.replace("Bearer ", ""));
    if (userError || !user) return json({ error: "Unauthorized" }, 401);

    const { data: doc, error: docError } = await supabase
      .from("person_documents")
      .select("id, title, content, user_id, memory_type")
      .eq("id", documentId)
      .eq("user_id", user.id)
      .single();

    if (docError || !doc) return json({ error: "Document not found" }, 404);
    if (doc.memory_type !== "long_term") return json({ error: "Only long-term documents are embedded" }, 400);

    const textToEmbed = `${doc.title}\n\n${doc.content}`.trim();
    if (!textToEmbed) return json({ error: "Document has no content to embed" }, 400);

    const openRouterKey = Deno.env.get("OPENROUTER_API_KEY");
    if (!openRouterKey) throw new Error("OPENROUTER_API_KEY not configured");

    const { embedding } = await getEmbeddingWithCredits(
      supabase,
      openRouterKey,
      user.id,
      "embed-document",
      textToEmbed.slice(0, MAX_EMBED_CHARS),
    );

    const { error: updateError } = await supabase
      .from("person_documents")
      .update({ embedding: JSON.stringify(embedding), embedding_updated_at: new Date().toISOString() })
      .eq("id", documentId)
      .eq("user_id", user.id);

    if (updateError) throw updateError;
    return json({ success: true, dimensions: embedding.length });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    if (isBalanceUnavailable(error)) {
      console.error("embed-document: allowance unreadable:", error);
      return json({ error: "Could not verify your AI credit balance.", code: "BALANCE_UNAVAILABLE" }, 503);
    }
    if (message === "INSUFFICIENT_CREDITS" || message === "NO_ACTIVE_PERIOD") {
      return json({ error: "Insufficient AI credits", code: "INSUFFICIENT_CREDITS" }, 402);
    }
    console.error("embed-document error:", error);
    return json({ error: message }, 500);
  }
});
