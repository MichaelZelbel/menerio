import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  checkBalance,
  getEmbeddingWithCredits,
  chatWithCredits,
} from "../_shared/llm-credits.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const OPENROUTER_API_KEY = Deno.env.get("OPENROUTER_API_KEY")!;
const SLACK_BOT_TOKEN = Deno.env.get("SLACK_BOT_TOKEN")!;
const SLACK_CAPTURE_CHANNEL = Deno.env.get("SLACK_CAPTURE_CHANNEL")!;
const BRAIN_OWNER_USER_ID = Deno.env.get("BRAIN_OWNER_USER_ID")!;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const METADATA_SYSTEM_PROMPT = `Extract metadata from the user's captured thought. Return JSON with:
- "people": array of people mentioned (empty if none)
- "action_items": array of implied to-dos (empty if none)
- "dates_mentioned": array of dates YYYY-MM-DD (empty if none)
- "topics": array of 1-3 short topic tags (always at least one)
- "type": one of "observation", "task", "idea", "reference", "person_note"
Only extract what's explicitly there.`;

async function replyInSlack(channel: string, threadTs: string, text: string): Promise<void> {
  await fetch("https://slack.com/api/chat.postMessage", {
    method: "POST",
    headers: { "Authorization": `Bearer ${SLACK_BOT_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ channel, thread_ts: threadTs, text }),
  });
}

Deno.serve(async (req: Request): Promise<Response> => {
  try {
    const body = await req.json();

    // Handle Slack URL verification challenge
    if (body.type === "url_verification") {
      return new Response(JSON.stringify({ challenge: body.challenge }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    const event = body.event;

    // Only process real user messages in the capture channel
    if (!event || event.type !== "message" || event.subtype || event.bot_id
        || event.channel !== SLACK_CAPTURE_CHANNEL) {
      return new Response("ok", { status: 200 });
    }

    const messageText: string = event.text;
    const channel: string = event.channel;
    const messageTs: string = event.ts;

    if (!messageText || messageText.trim() === "") return new Response("ok", { status: 200 });

    // Check credit balance for the brain owner
    const balance = await checkBalance(supabase, BRAIN_OWNER_USER_ID);
    if (!balance.allowed) {
      await replyInSlack(channel, messageTs, "⚠️ AI credits exhausted. Note saved without AI processing.");
      // Still save the note without AI processing
      const firstLine = messageText.split("\n")[0];
      const title = firstLine.length > 80 ? firstLine.substring(0, 77) + "..." : firstLine;
      await supabase.from("notes").insert({
        user_id: BRAIN_OWNER_USER_ID,
        content: messageText,
        title,
        metadata: { source: "slack", slack_ts: messageTs },
        tags: [],
      });
      return new Response("ok", { status: 200 });
    }

    // Generate embedding and extract metadata with credit deduction
    let embedding: number[] | null = null;
    let metadata: Record<string, unknown> = {};

    try {
      const [embResult, chatResult] = await Promise.all([
        getEmbeddingWithCredits(supabase, OPENROUTER_API_KEY, BRAIN_OWNER_USER_ID, "ingest-thought", messageText),
        chatWithCredits(
          supabase, OPENROUTER_API_KEY, BRAIN_OWNER_USER_ID, "ingest-thought",
          [
            { role: "system", content: METADATA_SYSTEM_PROMPT },
            { role: "user", content: messageText },
          ],
          { response_format: { type: "json_object" } }
        ),
      ]);

      embedding = embResult.embedding;
      try {
        metadata = JSON.parse(chatResult.result.choices[0].message.content);
      } catch {
        metadata = { topics: ["uncategorized"], type: "observation" };
      }
    } catch (err: any) {
      if (err.message === "INSUFFICIENT_CREDITS") {
        metadata = { topics: ["uncategorized"], type: "observation" };
      } else {
        throw err;
      }
    }

    // Extract title from first line
    const firstLine = messageText.split("\n")[0];
    const title = firstLine.length > 80 ? firstLine.substring(0, 77) + "..." : firstLine;

    // Insert into notes table
    const insertPayload: Record<string, unknown> = {
      user_id: BRAIN_OWNER_USER_ID,
      content: messageText,
      title,
      metadata: { ...metadata, source: "slack", slack_ts: messageTs },
      tags: Array.isArray((metadata as any).topics) ? (metadata as any).topics : [],
    };
    if (embedding) insertPayload.embedding = embedding;

    const { error } = await supabase.from("notes").insert(insertPayload);

    if (error) {
      console.error("Supabase insert error:", error);
      await replyInSlack(channel, messageTs, `Failed to capture: ${error.message}`);
      return new Response("error", { status: 500 });
    }

    // Build confirmation reply
    const meta = metadata as Record<string, unknown>;
    let confirmation = `Captured as *${meta.type || "thought"}*`;
    if (Array.isArray(meta.topics) && meta.topics.length > 0)
      confirmation += ` - ${meta.topics.join(", ")}`;
    if (Array.isArray(meta.people) && meta.people.length > 0)
      confirmation += `\nPeople: ${meta.people.join(", ")}`;
    if (Array.isArray(meta.action_items) && meta.action_items.length > 0)
      confirmation += `\nAction items: ${meta.action_items.join("; ")}`;

    await replyInSlack(channel, messageTs, confirmation);

    return new Response("ok", { status: 200 });
  } catch (err) {
    console.error("Function error:", err);
    return new Response("error", { status: 500 });
  }
});
