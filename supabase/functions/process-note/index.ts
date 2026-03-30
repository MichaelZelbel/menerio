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

async function getEmbedding(text: string): Promise<number[]> {
  const r = await fetch(`${OPENROUTER_BASE}/embeddings`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENROUTER_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "openai/text-embedding-3-small",
      input: text,
    }),
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
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { note_id } = await req.json();
    if (!note_id) {
      return new Response(JSON.stringify({ error: "note_id required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: note, error: fetchErr } = await supabase
      .from("notes")
      .select("id, title, content, user_id")
      .eq("id", note_id)
      .single();

    if (fetchErr || !note) {
      return new Response(JSON.stringify({ error: "Note not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const fullText = `${note.title}\n\n${note.content}`.trim();
    if (!fullText) {
      return new Response(JSON.stringify({ ok: true, skipped: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Generate embedding and extract metadata in parallel
    const [embedding, metadata] = await Promise.all([
      getEmbedding(fullText),
      extractMetadata(fullText),
    ]);

    // Update the note with both embedding and metadata
    const { error: updateErr } = await supabase
      .from("notes")
      .update({ embedding, metadata })
      .eq("id", note_id);

    if (updateErr) {
      console.error("Update error:", updateErr);
      return new Response(JSON.stringify({ error: updateErr.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Insert extracted action items into the action_items table
    const actionItems = Array.isArray(metadata.action_items) ? metadata.action_items as string[] : [];
    if (actionItems.length > 0) {
      // Look up contacts matching mentioned people for linking
      const people = Array.isArray(metadata.people) ? metadata.people as string[] : [];
      let contactMap: Record<string, string> = {};
      if (people.length > 0) {
        const { data: contacts } = await supabase
          .from("contacts")
          .select("id, name")
          .eq("user_id", note.user_id);
        if (contacts) {
          for (const c of contacts as any[]) {
            contactMap[c.name.toLowerCase()] = c.id;
          }
        }
      }

      const rows = actionItems.map((content: string) => {
        // Try to match a contact mentioned in this action item
        let contact_id: string | null = null;
        for (const [name, id] of Object.entries(contactMap)) {
          if (content.toLowerCase().includes(name)) {
            contact_id = id;
            break;
          }
        }
        return {
          user_id: note.user_id,
          content,
          source_note_id: note_id,
          contact_id,
          status: "open",
          priority: "normal",
        };
      });

      const { error: aiError } = await supabase.from("action_items").insert(rows);
      if (aiError) console.error("Action items insert error:", aiError);
    }

    // Trigger connection computation in the background (fire-and-forget)
    const computeUrl = `${SUPABASE_URL}/functions/v1/compute-connections`;
    fetch(computeUrl, {
      method: "POST",
      headers: {
        Authorization: authHeader!,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ note_id }),
    }).catch(err => console.error("compute-connections trigger error:", err));

    return new Response(JSON.stringify({ ok: true, metadata, action_items_created: actionItems.length }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("Function error:", err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
