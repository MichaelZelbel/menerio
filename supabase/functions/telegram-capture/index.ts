import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function sendTelegramMessage(
  botToken: string,
  chatId: number,
  text: string
) {
  await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: "HTML",
    }),
  });
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // Support both webhook (POST from Telegram) and setup calls (with Authorization)
  const url = new URL(req.url);

  // ── Setup endpoints (called from frontend with auth) ──
  const action = url.searchParams.get("action");
  if (action) {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "unauthorized" }, 401);

    const token = authHeader.replace("Bearer ", "");
    const {
      data: { user },
      error: authErr,
    } = await supabase.auth.getUser(token);
    if (authErr || !user) return json({ error: "unauthorized" }, 401);

    if (action === "set-webhook") {
      // Get user's telegram connection
      const { data: conn } = await supabase
        .from("telegram_connections")
        .select("*")
        .eq("user_id", user.id)
        .single();

      if (!conn) return json({ error: "No telegram connection found" }, 404);

      const webhookUrl = `${SUPABASE_URL}/functions/v1/telegram-capture?secret=${conn.webhook_secret}`;
      const res = await fetch(
        `https://api.telegram.org/bot${conn.bot_token}/setWebhook`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url: webhookUrl }),
        }
      );
      const data = await res.json();
      return json(data);
    }

    if (action === "delete-webhook") {
      const { data: conn } = await supabase
        .from("telegram_connections")
        .select("bot_token")
        .eq("user_id", user.id)
        .single();

      if (!conn) return json({ error: "No connection" }, 404);

      const res = await fetch(
        `https://api.telegram.org/bot${conn.bot_token}/deleteWebhook`,
        { method: "POST" }
      );
      const data = await res.json();
      return json(data);
    }

    if (action === "test") {
      const { data: conn } = await supabase
        .from("telegram_connections")
        .select("*")
        .eq("user_id", user.id)
        .single();

      if (!conn || !conn.telegram_chat_id) {
        return json(
          { error: "Not paired yet. Send your pairing code to the bot first." },
          400
        );
      }

      await sendTelegramMessage(
        conn.bot_token,
        conn.telegram_chat_id,
        "🧠 <b>Menerio is connected!</b>\n\nSend me any thought and I'll capture it to your brain."
      );
      return json({ ok: true });
    }

    return json({ error: "Unknown action" }, 400);
  }

  // ── Webhook handler (POST from Telegram) ──
  const secret = url.searchParams.get("secret");
  if (!secret) return json({ error: "missing secret" }, 400);

  try {
    // Look up connection by webhook secret
    const { data: conn, error: connErr } = await supabase
      .from("telegram_connections")
      .select("*")
      .eq("webhook_secret", secret)
      .eq("is_active", true)
      .single();

    if (connErr || !conn) {
      console.error("No active connection for secret");
      return json({ ok: true }); // Return 200 to Telegram to avoid retries
    }

    const update = await req.json();
    const message = update?.message;
    if (!message) return json({ ok: true });

    // Ignore bots, edited messages, non-text
    if (message.from?.is_bot) return json({ ok: true });
    if (!message.text) return json({ ok: true });
    if (update.edited_message) return json({ ok: true });

    const chatId = message.chat.id;
    const text = message.text.trim();

    // ── Pairing flow ──
    if (!conn.is_paired) {
      if (conn.pairing_code && text.toUpperCase() === conn.pairing_code.toUpperCase()) {
        // Pair the user
        await supabase
          .from("telegram_connections")
          .update({
            telegram_chat_id: chatId,
            is_paired: true,
            pairing_code: null,
          })
          .eq("id", conn.id);

        await sendTelegramMessage(
          conn.bot_token,
          chatId,
          "✅ <b>Paired successfully!</b>\n\nYou can now send me any thought and I'll capture it to your Menerio brain."
        );
        return json({ ok: true });
      } else {
        await sendTelegramMessage(
          conn.bot_token,
          chatId,
          "👋 Welcome! Please send your 6-character pairing code from Menerio settings to connect."
        );
        return json({ ok: true });
      }
    }

    // Verify the message is from the paired chat
    if (conn.telegram_chat_id !== chatId) {
      await sendTelegramMessage(
        conn.bot_token,
        chatId,
        "⚠️ This chat is not paired with a Menerio account."
      );
      return json({ ok: true });
    }

    // ── Capture the note via quick-capture ──
    const title =
      text.slice(0, 50).replace(/\n/g, " ") +
      (text.length > 50 ? "…" : "");

    const { data: note, error: noteErr } = await supabase
      .from("notes")
      .insert({
        user_id: conn.user_id,
        title,
        content: text,
        metadata: { is_quick_capture: true, source: "telegram" },
      })
      .select("id")
      .single();

    if (noteErr) {
      console.error("Note insert error:", noteErr);
      await sendTelegramMessage(
        conn.bot_token,
        chatId,
        "❌ Failed to save note. Please try again."
      );
      return json({ ok: true });
    }

    // Trigger async processing via process-note (fire-and-forget)
    fetch(`${SUPABASE_URL}/functions/v1/process-note`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      },
      body: JSON.stringify({ note_id: note.id }),
    }).catch((err) => console.error("process-note fire-and-forget error:", err));

    await sendTelegramMessage(
      conn.bot_token,
      chatId,
      `✅ <b>Captured!</b>\n"${text.slice(0, 100)}${text.length > 100 ? "…" : ""}"`
    );
    return json({ ok: true });
  } catch (err) {
    console.error("telegram-capture error:", err);
    return json({ ok: true }); // Always 200 for Telegram
  }
});
