import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  checkBalance,
  getEmbeddingWithCredits,
} from "../_shared/llm-credits.ts";
import { runChat } from "../_shared/llm-router.ts";
import { INGEST_THOUGHT_METADATA_PROMPT } from "../_shared/llm-defaults.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const OPENROUTER_API_KEY = Deno.env.get("OPENROUTER_API_KEY")!;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "unauthorized" }, 401);
    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
    if (authErr || !user) return json({ error: "unauthorized" }, 401);

    const body = await req.json();
    const messageText = (body.text || body.content || "").trim();
    if (!messageText) return json({ error: "text or content required" }, 400);
    const source = body.source || "slack";

    const balance = await checkBalance(supabase, user.id);

    let embedding: number[] | null = null;
    let metadata: Record<string, unknown> = { topics: ["uncategorized"], type: "observation" };

    if (balance.allowed) {
      try {
        const [embResult, chatResult] = await Promise.all([
          getEmbeddingWithCredits(supabase, OPENROUTER_API_KEY, user.id, "slack-capture", messageText).catch(() => null),
          runChat({
            db: supabase,
            userId: user.id,
            callSite: "ingest-thought.metadata",
            messages: [{ role: "user", content: messageText }],
            defaults: {
              provider: "openrouter",
              model: "deepseek/deepseek-v4-flash",
              systemPrompt: INGEST_THOUGHT_METADATA_PROMPT,
            },
            callOptions: { response_format: { type: "json_object" } },
          }),
        ]);
        if (embResult) embedding = embResult.embedding;
        try { metadata = JSON.parse(chatResult.content); } catch { /* keep default */ }
      } catch (err: any) {
        if (err.message !== "INSUFFICIENT_CREDITS") throw err;
      }
    }

    const firstLine = messageText.split("\n")[0];
    const title = firstLine.length > 80 ? firstLine.substring(0, 77) + "..." : firstLine;

    const insertPayload: Record<string, unknown> = {
      user_id: user.id, content: messageText, title,
      metadata: { ...metadata, source },
      tags: Array.isArray((metadata as any).topics) ? (metadata as any).topics : [],
    };
    if (embedding) insertPayload.embedding = embedding;

    const { data: note, error } = await supabase.from("notes").insert(insertPayload).select("id").single();
    if (error) throw error;

    return json({ ok: true, note_id: note.id, title });
  } catch (err) {
    console.error("slack-capture error:", err);
    return json({ error: err instanceof Error ? err.message : "Internal error" }, 500);
  }
});
