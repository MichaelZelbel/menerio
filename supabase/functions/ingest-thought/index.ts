import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  checkBalance,
  getEmbeddingWithCredits,
} from "../_shared/llm-credits.ts";
import { parseModelJson, runChat, sourceIsDataRule, sourceLanguageRule } from "../_shared/llm-router.ts";
import { INGEST_THOUGHT_METADATA_PROMPT } from "../_shared/llm-defaults.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const OPENROUTER_API_KEY = Deno.env.get("OPENROUTER_API_KEY")!;
const SLACK_BOT_TOKEN = Deno.env.get("SLACK_BOT_TOKEN")!;
const SLACK_CAPTURE_CHANNEL = Deno.env.get("SLACK_CAPTURE_CHANNEL")!;
const BRAIN_OWNER_USER_ID = Deno.env.get("BRAIN_OWNER_USER_ID")!;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

/**
 * The most message text the metadata call reads, process-note's budget for
 * the same call. The note itself is stored whole.
 */
const MAX_AI_INPUT_CHARS = 24_000;

/**
 * Verify a Slack request signature (https://api.slack.com/authentication/verifying-requests-from-slack).
 * signature = "v0=" + HMAC_SHA256(signingSecret, `v0:{timestamp}:{rawBody}`).
 * Uses a constant-time compare so a wrong signature leaks no timing info.
 */
async function verifySlackSignature(
  signingSecret: string,
  timestamp: string,
  rawBody: string,
  signature: string,
): Promise<boolean> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(signingSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const macBuf = await crypto.subtle.sign("HMAC", key, enc.encode(`v0:${timestamp}:${rawBody}`));
  const expected = "v0=" + Array.from(new Uint8Array(macBuf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  if (expected.length !== signature.length) return false;
  let mismatch = 0;
  for (let i = 0; i < expected.length; i++) {
    mismatch |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
  }
  return mismatch === 0;
}

async function replyInSlack(channel: string, threadTs: string, text: string): Promise<void> {
  await fetch("https://slack.com/api/chat.postMessage", {
    method: "POST",
    headers: { "Authorization": `Bearer ${SLACK_BOT_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ channel, thread_ts: threadTs, text }),
  });
}

Deno.serve(async (req: Request): Promise<Response> => {
  try {
    // Read the raw body BEFORE parsing — the Slack HMAC is computed over the
    // exact bytes, so we cannot use req.json() first.
    const rawBody = await req.text();

    // Verify the request actually came from Slack. Gated on SLACK_SIGNING_SECRET:
    // when it's set we reject unsigned/forged/replayed requests (this endpoint
    // has verify_jwt = false, so without this anyone who knows the URL + capture
    // channel id could inject notes into the owner's brain and drain credits).
    // When the secret is not yet configured we log loudly and continue, so the
    // capture flow never silently breaks.
    const signingSecret = Deno.env.get("SLACK_SIGNING_SECRET");
    if (signingSecret) {
      const timestamp = req.headers.get("X-Slack-Request-Timestamp") || "";
      const signature = req.headers.get("X-Slack-Signature") || "";
      if (!timestamp || !signature) {
        return new Response("unauthorized", { status: 401 });
      }
      // Replay protection: reject requests whose timestamp is more than 5 minutes old.
      const ageSeconds = Math.abs(Date.now() / 1000 - Number(timestamp));
      if (!Number.isFinite(ageSeconds) || ageSeconds > 60 * 5) {
        return new Response("unauthorized", { status: 401 });
      }
      const valid = await verifySlackSignature(signingSecret, timestamp, rawBody, signature);
      if (!valid) {
        return new Response("unauthorized", { status: 401 });
      }
    } else {
      console.warn(
        "[ingest-thought] SLACK_SIGNING_SECRET is not set — skipping Slack signature verification. " +
        "Set it in the edge-function secrets to reject spoofed/forged webhook requests.",
      );
    }

    const body = JSON.parse(rawBody);

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

    // Slack wants a 2xx within three seconds and re-sends the event up to
    // three times otherwise, saying why in X-Slack-Retry-Reason.
    //
    // Every retry used to be answered at once and dropped, on the theory that
    // the first delivery was still running. That holds only for a timeout.
    // When the first delivery never ran (the function failed to boot or hit a
    // worker limit, so the gateway answered 5xx), the retry was the only copy
    // left and the thought was gone without a word in the channel. Now only a
    // timeout retry is dropped; any other retry goes through, and the slack_ts
    // check below stops a second copy, because the note is saved before the
    // slow AI step rather than after it.
    const retryNum = Number(req.headers.get("X-Slack-Retry-Num") || "0");
    if (retryNum > 0 && req.headers.get("X-Slack-Retry-Reason") === "http_timeout") {
      return new Response("ok", { status: 200 });
    }
    if (messageTs) {
      const { data: already } = await supabase
        .from("notes")
        .select("id")
        .eq("user_id", BRAIN_OWNER_USER_ID)
        .eq("metadata->>slack_ts", messageTs)
        .limit(1);
      if (already && already.length > 0) return new Response("ok", { status: 200 });
    }

    // Save the message first, before any AI call. The embedding and the
    // metadata call can each take up to the provider timeout; a worker that
    // died in them used to take the unsaved thought with it.
    const firstLine = messageText.split("\n")[0];
    const title = firstLine.length > 80 ? firstLine.substring(0, 77) + "..." : firstLine;
    const { data: saved, error: saveErr } = await supabase
      .from("notes")
      .insert({
        user_id: BRAIN_OWNER_USER_ID,
        content: messageText,
        title,
        metadata: { source: "slack", slack_ts: messageTs },
        tags: [],
      })
      .select("id")
      .single();
    if (saveErr || !saved) {
      console.error("Supabase insert error:", saveErr);
      // Slack re-sends a failed event three times (after about 0, 1 and 5
      // minutes) and the retry saves it, so the channel only hears about a
      // failure that no retry is left to repair.
      if (retryNum >= 3) {
        await replyInSlack(channel, messageTs, "❌ Could not save this note. Please send it again.");
      }
      return new Response("error", { status: 500 });
    }

    // Check credit balance for the brain owner
    const balance = await checkBalance(supabase, BRAIN_OWNER_USER_ID);
    if (!balance.allowed) {
      await replyInSlack(channel, messageTs, "⚠️ AI credits exhausted. Note saved without AI processing.");
      return new Response("ok", { status: 200 });
    }

    // Generate embedding and extract metadata with credit deduction
    let embedding: number[] | null = null;
    let metadata: Record<string, unknown> = { topics: ["uncategorized"], type: "observation" };

    try {
      const [embResult, chatResult] = await Promise.all([
        // A failed embedding no longer throws away the metadata answer that
        // was already paid for (and the other way round is caught below).
        getEmbeddingWithCredits(supabase, OPENROUTER_API_KEY, BRAIN_OWNER_USER_ID, "ingest-thought", messageText)
          .catch(() => null),
        runChat({
          db: supabase,
          userId: BRAIN_OWNER_USER_ID,
          callSite: "ingest-thought.metadata",
          messages: [{ role: "user", content: messageText.slice(0, MAX_AI_INPUT_CHARS) }],
          defaults: {
            provider: "openrouter",
            model: "deepseek/deepseek-v4-flash",
            systemPrompt: INGEST_THOUGHT_METADATA_PROMPT,
          },
          systemSuffix: [sourceLanguageRule(), sourceIsDataRule()].join("\n\n"),
          callOptions: { response_format: { type: "json_object" } },
        }),
      ]);

      if (embResult) embedding = embResult.embedding;
      // JSON.parse("null") is null, and reading `.topics` of it threw outside
      // this try: the thought was answered 500 and, with the retry dropped,
      // lost. parseModelJson also reads a ```json fenced reply.
      const parsed = parseModelJson<Record<string, unknown>>(chatResult.content);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) metadata = parsed;
    } catch (err: any) {
      // Any failure here (no credits, a provider timeout, a 5xx) keeps the
      // note that is already saved, with default metadata; the note_ai_jobs
      // trigger re-extracts later.
      if (err?.message !== "INSUFFICIENT_CREDITS") {
        console.error("[ingest-thought] AI enrichment failed, saving without it:", err);
      }
    }

    const updatePayload: Record<string, unknown> = {
      metadata: { ...metadata, source: "slack", slack_ts: messageTs },
      tags: Array.isArray(metadata.topics) ? metadata.topics : [],
    };
    if (embedding) updatePayload.embedding = embedding;

    const { error } = await supabase.from("notes").update(updatePayload).eq("id", saved.id);
    if (error) {
      // The note itself is saved; only its tags and metadata are missing, and
      // the analysis job adds those later.
      console.error("Supabase update error (note saved):", error);
    }

    // Build confirmation reply
    const meta = metadata;
    let confirmation = `Captured as *${meta.type || "note"}*`;
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
