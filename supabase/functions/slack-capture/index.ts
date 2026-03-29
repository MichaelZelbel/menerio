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
    headers: { Authorization: `Bearer ${OPENROUTER_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: "openai/text-embedding-3-small", input: text }),
  });
  if (!r.ok) throw new Error(`Embedding failed: ${r.status}`);
  const d = await r.json();
  return d.data[0].embedding;
}

async function extractMetadata(text: string): Promise<Record<string, unknown>> {
  const r = await fetch(`${OPENROUTER_BASE}/chat/completions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${OPENROUTER_API_KEY}`, "Content-Type": "application/json" },
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

async function replyInSlack(token: string, channel: string, threadTs: string, text: string): Promise<void> {
  await fetch("https://slack.com/api/chat.postMessage", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ channel, thread_ts: threadTs, text }),
  });
}

/**
 * Look up which user owns this Slack channel.
 * We check connected_apps where app_name='slack' and the permissions JSONB
 * contains the matching channel_id.
 */
async function findOwner(channelId: string): Promise<{ userId: string; botToken: string } | null> {
  // First try: check connected_apps with app_name='slack'
  const { data: apps } = await supabase
    .from("connected_apps")
    .select("user_id, permissions")
    .eq("app_name", "slack")
    .eq("is_active", true);

  if (apps) {
    for (const app of apps) {
      const perms = app.permissions as Record<string, unknown> | null;
      if (perms && perms.channel_id === channelId && perms.bot_token) {
        return { userId: app.user_id, botToken: perms.bot_token as string };
      }
    }
  }

  // Fallback: use global env vars (backward compat with ingest-thought)
  const globalToken = Deno.env.get("SLACK_BOT_TOKEN");
  const globalChannel = Deno.env.get("SLACK_CAPTURE_CHANNEL");
  const globalOwner = Deno.env.get("BRAIN_OWNER_USER_ID");

  if (globalToken && globalChannel === channelId && globalOwner) {
    return { userId: globalOwner, botToken: globalToken };
  }

  return null;
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = await req.json();

    // Handle Slack URL verification
    if (body.type === "url_verification") {
      return new Response(JSON.stringify({ challenge: body.challenge }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    const event = body.event;

    // Only process real user messages (not bot messages, edits, or thread replies)
    if (
      !event ||
      event.type !== "message" ||
      event.subtype ||
      event.bot_id ||
      event.thread_ts // ignore thread replies
    ) {
      return new Response("ok", { status: 200 });
    }

    const messageText: string = event.text;
    const channel: string = event.channel;
    const messageTs: string = event.ts;

    if (!messageText || messageText.trim() === "") {
      return new Response("ok", { status: 200 });
    }

    // Find the owner of this channel
    const owner = await findOwner(channel);
    if (!owner) {
      console.log(`No owner found for channel ${channel}, ignoring.`);
      return new Response("ok", { status: 200 });
    }

    // Generate embedding and extract metadata in parallel
    const [embedding, metadata] = await Promise.all([
      getEmbedding(messageText).catch(() => null),
      extractMetadata(messageText),
    ]);

    const title = messageText.split("\n")[0].slice(0, 50) + (messageText.length > 50 ? "…" : "");

    // Insert note
    const insertPayload: Record<string, unknown> = {
      user_id: owner.userId,
      content: messageText,
      title,
      metadata: {
        ...metadata,
        is_quick_capture: true,
        source: "slack",
        slack_ts: messageTs,
        slack_channel: channel,
      },
      tags: Array.isArray((metadata as any).topics) ? (metadata as any).topics : [],
    };
    if (embedding) insertPayload.embedding = embedding;

    const { error } = await supabase.from("notes").insert(insertPayload);

    if (error) {
      console.error("Insert error:", error);
      await replyInSlack(owner.botToken, channel, messageTs, `❌ Failed to capture: ${error.message}`);
      return new Response("error", { status: 500 });
    }

    // Build confirmation reply
    const meta = metadata as Record<string, unknown>;
    let confirmation = `✅ Captured as *${meta.type || "thought"}*`;
    if (Array.isArray(meta.topics) && meta.topics.length > 0) {
      confirmation += ` — ${(meta.topics as string[]).join(", ")}`;
    }
    if (Array.isArray(meta.people) && meta.people.length > 0) {
      confirmation += ` | People: ${(meta.people as string[]).join(", ")}`;
    }
    if (Array.isArray(meta.action_items) && meta.action_items.length > 0) {
      confirmation += ` | Actions: ${(meta.action_items as string[]).join("; ")}`;
    }

    await replyInSlack(owner.botToken, channel, messageTs, confirmation);

    return new Response("ok", { status: 200 });
  } catch (err) {
    console.error("slack-capture error:", err);
    return new Response("error", { status: 500 });
  }
});
