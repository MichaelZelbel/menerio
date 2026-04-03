import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  checkBalance,
  getEmbeddingWithCredits,
  chatWithCredits,
  insufficientCreditsResponse,
} from "../_shared/llm-credits.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const OPENROUTER_API_KEY = Deno.env.get("OPENROUTER_API_KEY")!;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const METADATA_SYSTEM_PROMPT = `Extract metadata from the user's note. Return JSON with:
- "people": array of people mentioned (empty if none)
- "action_items": array of implied to-dos (empty if none)
- "dates_mentioned": array of dates in YYYY-MM-DD format (empty if none)
- "topics": array of 1-5 short topic tags (always generate at least one)
- "type": one of "observation", "task", "idea", "reference", "person_note", "meeting_note", "decision", "project"
- "sentiment": one of "positive", "negative", "neutral"
- "summary": one-sentence summary of the note
Only extract what's explicitly there. Don't invent details.`;

/* ── Review Queue suggestion generator ── */
async function generateReviewItems(
  userId: string,
  noteId: string,
  noteTitle: string,
  metadata: Record<string, unknown>,
) {
  try {
    const people = Array.isArray(metadata.people) ? (metadata.people as string[]) : [];
    const dates = Array.isArray(metadata.dates_mentioned) ? (metadata.dates_mentioned as string[]) : [];
    const noteType = metadata.type as string | undefined;
    const summary = (metadata.summary as string) || noteTitle;

    const suggestions: Array<{
      user_id: string;
      source_note_id: string;
      suggestion_type: string;
      title: string;
      description: string;
      payload: Record<string, unknown>;
      status: string;
    }> = [];

    // Check which apps are connected
    const { data: connectedApps } = await supabase
      .from("connected_apps")
      .select("app_name")
      .eq("user_id", userId)
      .eq("connection_status", "active")
      .eq("is_active", true);

    const activeApps = new Set((connectedApps || []).map((a: any) => a.app_name));

    // Event detection: dates + people → suggest Temerio / Cherishly
    if (dates.length > 0 && (people.length > 0 || noteType === "meeting_note")) {
      const headline = noteTitle || summary;
      const happened_at = dates[0] + "T12:00";

      if (activeApps.has("temerio")) {
        suggestions.push({
          user_id: userId,
          source_note_id: noteId,
          suggestion_type: "add_event_temerio",
          title: `Add "${headline}" as a Temerio event`,
          description: `Detected date ${dates[0]} and people: ${people.join(", ") || "—"}. This looks like an event worth tracking.`,
          payload: {
            headline,
            description: summary,
            happened_at,
            people_names: people,
            emotion_valence: 0.7,
            category: "life",
          },
          status: "pending",
        });
      }

      if (activeApps.has("cherishly")) {
        suggestions.push({
          user_id: userId,
          source_note_id: noteId,
          suggestion_type: "add_event_cherishly",
          title: `Add "${headline}" to Cherishly`,
          description: `A moment with ${people.join(", ") || "someone special"} on ${dates[0]}. Save it as a cherished memory?`,
          payload: {
            headline,
            description: summary,
            happened_at,
            people_names: people,
            emotion_valence: 0.8,
            category: "life",
          },
          status: "pending",
        });
      }
    }

    // Person detection: check if mentioned people exist as contacts
    if (people.length > 0) {
      const { data: existingContacts } = await supabase
        .from("contacts")
        .select("name")
        .eq("user_id", userId);

      const existingNames = new Set(
        (existingContacts || []).map((c: any) => c.name.toLowerCase()),
      );

      for (const person of people) {
        if (!existingNames.has(person.toLowerCase())) {
          suggestions.push({
            user_id: userId,
            source_note_id: noteId,
            suggestion_type: "add_contact",
            title: `Add "${person}" to your People`,
            description: `${person} was mentioned in "${noteTitle}" but isn't in your contacts yet.`,
            payload: { name: person },
            status: "pending",
          });
        }
      }
    }

    // Insert all suggestions
    if (suggestions.length > 0) {
      const { error } = await supabase.from("review_queue").insert(suggestions);
      if (error) console.error("review_queue insert error:", error);
      else console.log(`Created ${suggestions.length} review suggestions for note ${noteId}`);
    }
  } catch (err) {
    console.error("generateReviewItems error:", err);
  }
}

/* ── Main background processor ── */
async function processInBackground(noteId: string, authHeader: string) {
  try {
    const { data: note, error: fetchErr } = await supabase
      .from("notes")
      .select("id, title, content, user_id")
      .eq("id", noteId)
      .single();

    if (fetchErr || !note) {
      console.error("Note not found:", noteId);
      return;
    }

    let fullText = `${note.title}\n\n${note.content}`.trim();
    if (!fullText) return;

    // Include media analysis content in the embedding text
    const { data: mediaEntries } = await supabase
      .from("media_analysis")
      .select("extracted_text, description, topics")
      .eq("note_id", noteId)
      .eq("analysis_status", "complete");

    let mediaTopics: string[] = [];
    if (mediaEntries && mediaEntries.length > 0) {
      const mediaTexts = mediaEntries.map((m: any) => {
        if (m.topics) mediaTopics.push(...m.topics);
        return [m.description, m.extracted_text].filter(Boolean).join(" ");
      });
      fullText += "\n\n[Media content]\n" + mediaTexts.join("\n");
    }

    // Pre-check balance before making any LLM calls
    const balance = await checkBalance(supabase, note.user_id);
    if (!balance.allowed) {
      console.log(`Skipping AI processing for note ${noteId}: insufficient credits for user ${note.user_id}`);
      return;
    }

    // Generate embedding and extract metadata in parallel (each deducts tokens)
    let embedding: number[] | null = null;
    let metadata: Record<string, unknown> = {};
    let lastCredits: any = null;

    try {
      const [embResult, chatResult] = await Promise.all([
        getEmbeddingWithCredits(supabase, OPENROUTER_API_KEY, note.user_id, "process-note", fullText),
        chatWithCredits(
          supabase, OPENROUTER_API_KEY, note.user_id, "process-note",
          [
            { role: "system", content: METADATA_SYSTEM_PROMPT },
            { role: "user", content: fullText },
          ],
          { response_format: { type: "json_object" } }
        ),
      ]);

      embedding = embResult.embedding;
      lastCredits = chatResult.credits;

      try {
        metadata = JSON.parse(chatResult.result.choices[0].message.content);
      } catch {
        metadata = { topics: ["uncategorized"], type: "observation", sentiment: "neutral" };
      }
    } catch (err: any) {
      if (err.message === "INSUFFICIENT_CREDITS") {
        console.log(`Credit limit reached during processing of note ${noteId}`);
        return;
      }
      throw err;
    }

    // Merge media-derived topics into note metadata
    if (mediaTopics.length > 0 && Array.isArray(metadata.topics)) {
      const existingTopics = metadata.topics as string[];
      const merged = [...new Set([...existingTopics, ...mediaTopics])];
      metadata.topics = merged;
    }

    // Update the note with both embedding and metadata
    const { error: updateErr } = await supabase
      .from("notes")
      .update({ embedding, metadata })
      .eq("id", noteId);

    if (updateErr) {
      console.error("Update error:", updateErr);
      return;
    }

    // Insert extracted action items into the action_items table
    const actionItems = Array.isArray(metadata.action_items) ? metadata.action_items as string[] : [];
    if (actionItems.length > 0) {
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
          source_note_id: noteId,
          contact_id,
          status: "open",
          priority: "normal",
        };
      });

      const { error: aiError } = await supabase.from("action_items").insert(rows);
      if (aiError) console.error("Action items insert error:", aiError);
    }

    // Generate review queue suggestions (no extra LLM calls)
    await generateReviewItems(note.user_id, noteId, note.title, metadata);

    // Trigger connection computation (fire-and-forget)
    const computeUrl = `${SUPABASE_URL}/functions/v1/compute-connections`;
    fetch(computeUrl, {
      method: "POST",
      headers: {
        Authorization: authHeader,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ note_id: noteId }),
    }).catch(err => console.error("compute-connections trigger error:", err));

    console.log("process-note completed for:", noteId, "remaining credits:", lastCredits?.remaining_credits);
  } catch (err) {
    console.error("Background processing error:", err);
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

    // @ts-ignore EdgeRuntime is available in Supabase edge functions
    EdgeRuntime.waitUntil(processInBackground(note_id, authHeader));

    return new Response(JSON.stringify({ ok: true, processing: true }), {
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
