import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const OPENROUTER_API_KEY = Deno.env.get("OPENROUTER_API_KEY")!;
const OPENROUTER_BASE = "https://openrouter.ai/api/v1";

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

const BATCH_SIZE = 10;

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Unauthorized" }, 401);

    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
    if (authErr || !user) return json({ error: "Unauthorized" }, 401);

    // Find notes without metadata
    const { data: notes, error: fetchErr } = await supabase
      .from("notes")
      .select("id, title, content")
      .eq("user_id", user.id)
      .eq("is_trashed", false)
      .or("metadata.is.null,metadata.eq.{}")
      .order("created_at", { ascending: false })
      .limit(200);

    if (fetchErr) throw fetchErr;
    if (!notes || notes.length === 0) {
      return json({ ok: true, total: 0, processed: 0, message: "All notes already classified" });
    }

    const total = notes.length;
    let processed = 0;
    const errors: string[] = [];

    // Process in batches
    for (let i = 0; i < notes.length; i += BATCH_SIZE) {
      const batch = notes.slice(i, i + BATCH_SIZE);

      const results = await Promise.allSettled(
        batch.map(async (note) => {
          const fullText = `${note.title}\n\n${note.content}`.trim();
          if (!fullText || fullText.length < 5) return null;

          const [embedding, metadata] = await Promise.all([
            getEmbedding(fullText).catch(() => null),
            extractMetadata(fullText),
          ]);

          const updatePayload: Record<string, unknown> = { metadata };
          if (embedding) updatePayload.embedding = embedding;

          const { error: updateErr } = await supabase
            .from("notes")
            .update(updatePayload)
            .eq("id", note.id);

          if (updateErr) throw updateErr;
          return note.id;
        })
      );

      for (const r of results) {
        if (r.status === "fulfilled" && r.value !== null) processed++;
        else if (r.status === "rejected") errors.push(String(r.reason));
      }

      // Small delay between batches to avoid rate limits
      if (i + BATCH_SIZE < notes.length) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    }

    return json({
      ok: true,
      total,
      processed,
      errors: errors.length > 0 ? errors.slice(0, 5) : undefined,
      message: `Processed ${processed} of ${total} notes`,
    });
  } catch (err) {
    console.error("backfill-metadata error:", err);
    return json({ error: err.message }, 500);
  }
});
