import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { resolveSystemPrompt } from "../_shared/llm-router.ts";
import { AI_MODERATE_CONTENT_PROMPT } from "../_shared/llm-defaults.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const ok = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const BATCH_SIZE = 5;
const MAX_RETRIES = 3;
const CONFIDENCE_THRESHOLD = 0.85;
const STRIKE_LIMIT = 5;

const RESEND_GATEWAY = "https://connector-gateway.lovable.dev/resend/emails";
const AI_GATEWAY = "https://ai.gateway.lovable.dev/v1/chat/completions";

const CLASSIFY_TOOL = {
  type: "function" as const,
  function: {
    name: "classify_content",
    description: "Classify whether content violates community guidelines",
    parameters: {
      type: "object",
      properties: {
        is_violation: { type: "boolean", description: "True if the content violates guidelines" },
        category: { type: "string", enum: ["sexual", "hate", "malware", "pii", "injection"], description: "Violation category if is_violation is true" },
        confidence: { type: "number", description: "Confidence score 0.0 to 1.0" },
        reason: { type: "string", description: "Brief explanation of the classification" },
      },
      required: ["is_violation", "confidence", "reason"],
      additionalProperties: false,
    },
  },
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const lovableKey = Deno.env.get("LOVABLE_API_KEY");
    const resendKey = Deno.env.get("RESEND_API_KEY");

    if (!lovableKey) return ok({ error: "LOVABLE_API_KEY not configured" }, 500);

    const admin = createClient(supabaseUrl, serviceKey);

    // Fetch pending items
    const { data: items, error: fetchErr } = await admin
      .from("moderation_review_queue")
      .select("*")
      .eq("status", "pending")
      .lt("retry_count", MAX_RETRIES)
      .order("created_at", { ascending: true })
      .limit(BATCH_SIZE);

    if (fetchErr) {
      console.error("Failed to fetch queue:", fetchErr);
      return ok({ error: "Failed to fetch queue" }, 500);
    }

    if (!items || items.length === 0) return ok({ processed: 0, message: "No pending items" });

    const results: { id: string; status: string }[] = [];

    for (const item of items) {
      try {
        const classification = await classifyContent(item.content_snapshot, lovableKey);

        if (!classification) {
          // AI call failed
          await admin
            .from("moderation_review_queue")
            .update({ retry_count: item.retry_count + 1, ...(item.retry_count + 1 >= MAX_RETRIES ? { status: "error" } : {}) })
            .eq("id", item.id);
          results.push({ id: item.id, status: item.retry_count + 1 >= MAX_RETRIES ? "error" : "retry" });
          continue;
        }

        const isViolation = classification.is_violation && classification.confidence >= CONFIDENCE_THRESHOLD;

        if (isViolation) {
          // 1. Revoke share link
          await admin
            .from("shared_notes")
            .update({ is_active: false })
            .eq("note_id", item.item_id);

          // 2. Log moderation event
          await admin.from("moderation_events").insert({
            user_id: item.user_id,
            action: "share_note",
            item_type: item.item_type,
            item_id: item.item_id,
            flagged_content: item.content_snapshot.slice(0, 500),
            category: classification.category,
            result: "blocked",
            tier: "ai",
            matched_words: [],
          });

          // 3. Increment strikes
          await incrementStrikes(admin, item.user_id);

          // 4. Send notification email
          const noteTitle = extractTitle(item.content_snapshot);
          const categoryLabel = classification.category || "policy violation";
          await sendViolationEmail(admin, item.user_id, noteTitle, categoryLabel, lovableKey, resendKey);

          // 5. Mark as violation
          await admin
            .from("moderation_review_queue")
            .update({
              status: "violation",
              ai_category: classification.category,
              ai_confidence: classification.confidence,
              ai_reason: classification.reason,
              reviewed_at: new Date().toISOString(),
            })
            .eq("id", item.id);

          results.push({ id: item.id, status: "violation" });
        } else {
          // Mark as reviewed, no action
          await admin
            .from("moderation_review_queue")
            .update({
              status: "reviewed",
              ai_category: classification.category || null,
              ai_confidence: classification.confidence,
              ai_reason: classification.reason,
              reviewed_at: new Date().toISOString(),
            })
            .eq("id", item.id);

          results.push({ id: item.id, status: "reviewed" });
        }
      } catch (err) {
        console.error(`Error processing item ${item.id}:`, err);
        await admin
          .from("moderation_review_queue")
          .update({ retry_count: item.retry_count + 1, ...(item.retry_count + 1 >= MAX_RETRIES ? { status: "error" } : {}) })
          .eq("id", item.id);
        results.push({ id: item.id, status: "retry_error" });
      }
    }

    return ok({ processed: results.length, results });
  } catch (err) {
    console.error("ai-moderate-content error:", err);
    return ok({ error: "Internal error" }, 500);
  }
});

async function classifyContent(content: string, apiKey: string): Promise<{ is_violation: boolean; category?: string; confidence: number; reason: string } | null> {
  try {
    const resp = await fetch(AI_GATEWAY, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: `Classify this shared note content:\n\n${content.slice(0, 5000)}` },
        ],
        tools: [CLASSIFY_TOOL],
        tool_choice: { type: "function", function: { name: "classify_content" } },
      }),
    });

    if (!resp.ok) {
      console.error("AI gateway error:", resp.status, await resp.text());
      return null;
    }

    const data = await resp.json();
    const toolCall = data.choices?.[0]?.message?.tool_calls?.[0];
    if (!toolCall) {
      console.error("No tool call in AI response:", JSON.stringify(data));
      return null;
    }

    return JSON.parse(toolCall.function.arguments);
  } catch (err) {
    console.error("classifyContent error:", err);
    return null;
  }
}

async function incrementStrikes(admin: any, userId: string) {
  const { data: existing } = await admin
    .from("user_suspensions")
    .select("id, strike_count")
    .eq("user_id", userId)
    .maybeSingle();

  if (existing) {
    const row = existing as { id: string; strike_count: number };
    const newCount = row.strike_count + 1;
    const updates: Record<string, unknown> = { strike_count: newCount };
    if (newCount >= STRIKE_LIMIT) {
      updates.suspended = true;
      updates.suspended_at = new Date().toISOString();
      updates.suspension_reason = "Automatic suspension: repeated content violations";
    }
    await admin.from("user_suspensions").update(updates).eq("id", row.id);
  } else {
    await admin.from("user_suspensions").insert({
      user_id: userId,
      strike_count: 1,
    });
  }
}

function extractTitle(content: string): string {
  const firstLine = content.split("\n")[0]?.trim();
  if (firstLine && firstLine.length > 0) return firstLine.slice(0, 100);
  return "Untitled Note";
}

async function sendViolationEmail(
  admin: any,
  userId: string,
  noteTitle: string,
  category: string,
  lovableKey: string,
  resendKey?: string,
) {
  if (!resendKey) {
    console.warn("RESEND_API_KEY not configured, skipping violation email");
    return;
  }

  // Get user email
  const { data: userData } = await admin.auth.admin.getUserById(userId);
  const email = userData?.user?.email;
  if (!email) {
    console.warn("No email for user:", userId);
    return;
  }

  try {
    const resp = await fetch(RESEND_GATEWAY, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${lovableKey}`,
        "X-Connection-Api-Key": resendKey,
      },
      body: JSON.stringify({
        from: "Menerio <noreply@menerio.com>",
        to: [email],
        subject: `Your shared note "${noteTitle}" has been unshared`,
        html: `<p>Our automated content review found that your note "<strong>${noteTitle}</strong>" may violate our <a href="https://menerio.lovable.app/terms">Community Guidelines</a> (Category: ${category}).</p>
<p>Your note's public link has been removed. You can still access and edit your note privately.</p>
<p>If you believe this is a mistake, please contact <a href="mailto:support@menerio.com">support@menerio.com</a>.</p>`,
      }),
    });

    if (!resp.ok) {
      console.error("Resend error:", resp.status, await resp.text());
    }
  } catch (err) {
    console.error("Email send error:", err);
  }
}
