import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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

    const apiKey = Deno.env.get("LOVABLE_API_KEY");
    if (!apiKey) throw new Error("LOVABLE_API_KEY not configured");

    const queryEmbedding = await generateEmbedding(apiKey, query);
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
    console.error("search-documents error:", error);
    return json({ error: error instanceof Error ? error.message : "Unknown error" }, 500);
  }
});

async function generateEmbedding(apiKey: string, text: string): Promise<number[]> {
  const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "google/gemini-2.5-flash-lite",
      temperature: 0,
      messages: [
        { role: "system", content: "You are an embedding generator. Produce a semantic vector through the required tool call." },
        { role: "user", content: `Generate a 768-dimensional semantic embedding vector for this text:\n\n${text.substring(0, 2000)}` },
      ],
      tools: [{ type: "function", function: { name: "store_embedding", description: "Store the embedding vector", parameters: { type: "object", properties: { embedding: { type: "array", items: { type: "number" } } }, required: ["embedding"], additionalProperties: false } } }],
      tool_choice: { type: "function", function: { name: "store_embedding" } },
    }),
  });
  if (!response.ok) throw new Error(`Embedding generation failed: ${response.status} ${await response.text()}`);
  const data = await response.json();
  const args = JSON.parse(data.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments || "{}");
  let embedding = Array.isArray(args.embedding) ? args.embedding : [];
  embedding = embedding.slice(0, 768).map((v: unknown) => Number(v) || 0);
  while (embedding.length < 768) embedding.push(0);
  const magnitude = Math.sqrt(embedding.reduce((sum: number, v: number) => sum + v * v, 0));
  return magnitude > 0 ? embedding.map((v: number) => v / magnitude) : embedding;
}
