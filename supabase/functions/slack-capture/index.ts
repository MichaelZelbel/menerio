import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  checkBalance,
  getEmbeddingWithCredits,
  chatWithCredits,
} from "../_shared/llm-credits.ts";

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

const METADATA_SYSTEM_PROMPT = `Extract metadata from the user's captured thought. Return JSON with:
- "people": array of people mentioned (empty if none)
- "action_items": array of implied to-dos (empty if none)
- "dates_mentioned": array of dates YYYY-MM-DD (empty if none)
- "topics": array of 1-3 short topic tags (always at least one)
- "type": one of "observation", "task", "idea", "reference", "person_note"
Only extract what's explicitly there.`;

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
          chatWithCredits(
            supabase, OPENROUTER_API_KEY, user.id, "slack-capture",
            [
              { role: "system", content: METADATA_SYSTEM_PROMPT },
              { role: "user", content: messageText },
            ],
            { response_format: { type: "json_object" } }
          ),
        ]);
        if (embResult) embedding = embResult.embedding;
        try { metadata = JSON.parse(chatResult.result.choices[0].message.content); } catch { /* keep default */ }
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
    return json({ error: err.message }, 500);
  }
});
