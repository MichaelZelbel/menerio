import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const OPENROUTER_API_KEY = Deno.env.get("OPENROUTER_API_KEY")!;
const OPENROUTER_BASE = "https://openrouter.ai/api/v1";

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-api-key",
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
  if (!r.ok) {
    const msg = await r.text().catch(() => "");
    throw new Error(`Embedding failed: ${r.status} ${msg}`);
  }
  const d = await r.json();
  return d.data[0].embedding;
}

async function extractMetadata(text: string): Promise<Record<string, unknown>> {
  const r = await fetch(`${OPENROUTER_BASE}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENROUTER_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "openai/gpt-4o-mini",
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: `Extract metadata from the user's note. Return JSON with:
- "people": array of people mentioned (empty if none)
- "action_items": array of implied to-dos (empty if none)
- "dates_mentioned": array of dates in YYYY-MM-DD format (empty if none)
- "topics": array of 1-5 short topic tags (always generate at least one)
- "type": one of "observation", "task", "idea", "reference", "person_note", "meeting_note", "decision", "project"
- "sentiment": one of "positive", "negative", "neutral"
- "summary": one-sentence summary of the note
Only extract what's explicitly there. Don't invent details.`,
        },
        { role: "user", content: text },
      ],
    }),
  });
  const d = await r.json();
  try {
    return JSON.parse(d.choices[0].message.content);
  } catch {
    return { topics: ["uncategorized"], type: "observation", sentiment: "neutral" };
  }
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Authenticate: accept either x-api-key (for external integrations) or Authorization bearer (Supabase auth)
    let userId: string | null = null;
    let sourceName = "api";

    const apiKey = req.headers.get("x-api-key");
    const authHeader = req.headers.get("Authorization");

    if (apiKey) {
      // Look up API key in connected_apps
      const { data: app, error: appErr } = await supabase
        .from("connected_apps")
        .select("user_id, app_name, is_active")
        .eq("api_key", apiKey)
        .single();

      if (appErr || !app || !app.is_active) {
        return json({ error: "unauthorized" }, 401);
      }
      userId = app.user_id;
      sourceName = app.app_name;
    } else if (authHeader) {
      const token = authHeader.replace("Bearer ", "");
      const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
      if (authErr || !user) return json({ error: "unauthorized" }, 401);
      userId = user.id;
      sourceName = "web";
    } else {
      return json({ error: "unauthorized" }, 401);
    }

    const body = await req.json();
    const content = (body.content || "").trim();
    if (!content) return json({ error: "content is required" }, 400);

    const source = body.source || sourceName;
    const title = content.slice(0, 50).replace(/\n/g, " ") + (content.length > 50 ? "…" : "");

    // Create the note
    const { data: note, error: insertErr } = await supabase
      .from("notes")
      .insert({
        user_id: userId,
        title,
        content,
        metadata: { is_quick_capture: true, source },
      })
      .select("id")
      .single();

    if (insertErr) throw insertErr;

    // Generate embedding + extract metadata in parallel
    let metadata: Record<string, unknown> = {};
    try {
      const [embedding, extracted] = await Promise.all([
        getEmbedding(content).catch(() => null),
        extractMetadata(content),
      ]);

      metadata = { ...extracted, is_quick_capture: true, source };

      const updatePayload: Record<string, unknown> = { metadata };
      if (embedding) updatePayload.embedding = embedding;

      await supabase.from("notes").update(updatePayload).eq("id", note.id);
    } catch (err) {
      console.error("Processing error (non-fatal):", err);
    }

    return json({
      ok: true,
      note_id: note.id,
      title,
      metadata,
    }, 201);
  } catch (err) {
    console.error("quick-capture error:", err);
    return json({ error: err.message }, 500);
  }
});
