import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const OPENROUTER_API_KEY = Deno.env.get("OPENROUTER_API_KEY")!;
const SLACK_BOT_TOKEN = Deno.env.get("SLACK_BOT_TOKEN")!;
const SLACK_SIGNING_SECRET = Deno.env.get("SLACK_SIGNING_SECRET")!;
const SLACK_CAPTURE_CHANNEL = Deno.env.get("SLACK_CAPTURE_CHANNEL")!;
const OPENROUTER_BASE = "https://openrouter.ai/api/v1";

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// --- Slack signature verification ---
async function verifySlackSignature(
  body: string,
  timestamp: string,
  signature: string
): Promise<boolean> {
  const sigBaseString = `v0:${timestamp}:${body}`;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(SLACK_SIGNING_SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(sigBaseString));
  const hex = Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return `v0=${hex}` === signature;
}

// --- OpenRouter helpers ---
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
- "dates_mentioned": array of dates YYYY-MM-DD (empty if none)
- "topics": array of 1-3 short topic tags (always at least one)
- "type": one of "observation", "task", "idea", "reference", "person_note", "meeting", "journal"
- "summary": one-sentence summary of the note
Only extract what's explicitly there.`,
        },
        { role: "user", content: text },
      ],
    }),
  });
  const d = await r.json();
  try {
    return JSON.parse(d.choices[0].message.content);
  } catch {
    return { topics: ["uncategorized"], type: "observation" };
  }
}

// --- Look up which user_id owns this Slack integration ---
// For now, we map the channel to a specific user. 
// You can extend this with a slack_user_map table later.
async function getOwnerUserId(): Promise<string | null> {
  // We store the owner user_id in the SLACK_OWNER_USER_ID secret
  return Deno.env.get("SLACK_OWNER_USER_ID") || null;
}

// --- React to the message in Slack with ✅ ---
async function addSlackReaction(channel: string, timestamp: string) {
  try {
    await fetch("https://slack.com/api/reactions.add", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${SLACK_BOT_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        channel,
        timestamp,
        name: "brain", // 🧠 emoji
      }),
    });
  } catch (e) {
    console.warn("Failed to add Slack reaction:", e);
  }
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const rawBody = await req.text();

    // Verify Slack signature
    const timestamp = req.headers.get("x-slack-request-timestamp") || "";
    const slackSig = req.headers.get("x-slack-signature") || "";

    // Skip verification for url_verification challenge (initial setup)
    const payload = JSON.parse(rawBody);

    // Handle Slack URL verification challenge
    if (payload.type === "url_verification") {
      return new Response(JSON.stringify({ challenge: payload.challenge }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Verify signature for all other requests
    if (SLACK_SIGNING_SECRET) {
      const valid = await verifySlackSignature(rawBody, timestamp, slackSig);
      if (!valid) {
        console.error("Invalid Slack signature");
        return new Response("Invalid signature", { status: 401 });
      }
    }

    // Handle event callbacks
    if (payload.type === "event_callback") {
      const event = payload.event;

      // Only process messages (not bot messages, not edits, not deletes)
      if (
        event.type !== "message" ||
        event.subtype ||
        event.bot_id
      ) {
        return new Response("ok", { headers: corsHeaders });
      }

      // Only capture from the configured channel
      if (SLACK_CAPTURE_CHANNEL && event.channel !== SLACK_CAPTURE_CHANNEL) {
        return new Response("ok", { headers: corsHeaders });
      }

      const text = event.text?.trim();
      if (!text) {
        return new Response("ok", { headers: corsHeaders });
      }

      const userId = await getOwnerUserId();
      if (!userId) {
        console.error("SLACK_OWNER_USER_ID not configured");
        return new Response("ok", { headers: corsHeaders });
      }

      // Generate title from first line
      const firstLine = text.split("\n")[0];
      const title = firstLine.length > 80 ? firstLine.substring(0, 77) + "..." : firstLine;

      // Generate embedding and extract metadata in parallel
      const [embedding, metadata] = await Promise.all([
        getEmbedding(text),
        extractMetadata(text),
      ]);

      const enrichedMetadata = {
        ...metadata,
        source: "slack",
        slack_channel: event.channel,
        slack_user: event.user,
        slack_ts: event.ts,
        ingested_at: new Date().toISOString(),
      };

      // Insert the note
      const { error: insertErr } = await supabase
        .from("notes")
        .insert({
          user_id: userId,
          title,
          content: text,
          embedding,
          metadata: enrichedMetadata,
          tags: (metadata as any).topics || [],
        });

      if (insertErr) {
        console.error("Insert error:", insertErr);
      } else {
        // React to the message with 🧠 to confirm capture
        await addSlackReaction(event.channel, event.ts);
      }
    }

    return new Response("ok", { headers: corsHeaders });
  } catch (err) {
    console.error("Slack capture error:", err);
    return new Response("ok", { status: 200, headers: corsHeaders });
  }
});
