import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import nacl from "https://esm.sh/tweetnacl@1.0.3";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-signature-ed25519, x-signature-timestamp",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function hexToUint8Array(hex: string): Uint8Array {
  const arr = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    arr[i / 2] = parseInt(hex.substr(i, 2), 16);
  }
  return arr;
}

function verifyDiscordSignature(
  publicKey: string,
  signature: string,
  timestamp: string,
  body: string
): boolean {
  try {
    const sig = hexToUint8Array(signature);
    const key = hexToUint8Array(publicKey);
    const msg = new TextEncoder().encode(timestamp + body);
    return nacl.sign.detached.verify(msg, sig, key);
  } catch {
    return false;
  }
}

/**
 * Of several connections whose public key verifies one interaction, the one
 * whose bot token Discord says belongs to that application. Null when none or
 * more than one does, or when there is no application id to compare with.
 * Only runs on a tie, which a correctly set up account never produces.
 */
async function pickConnectionOwningApplication(conns: any[], appId: string | null): Promise<any | null> {
  if (!appId) return null;
  // In parallel: Discord gives an interaction three seconds in all.
  const owns = await Promise.all(conns.map(async (c) => {
    try {
      const res = await fetch("https://discord.com/api/v10/applications/@me", {
        headers: { Authorization: `Bot ${c.bot_token}` },
        signal: AbortSignal.timeout(1_500),
      });
      if (!res.ok) {
        await res.body?.cancel();
        return false;
      }
      const app = await res.json();
      return app?.id === appId;
    } catch {
      return false; // unreachable or not JSON: this row proves nothing
    }
  }));
  const owners = conns.filter((_, i) => owns[i]);
  return owners.length === 1 ? owners[0] : null;
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

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

    const { data: conn } = await supabase
      .from("discord_connections")
      .select("*")
      .eq("user_id", user.id)
      .single();

    if (!conn && action !== "register-slash") {
      return json({ error: "No discord connection found" }, 404);
    }

    if (action === "register-slash") {
      if (!conn) return json({ error: "Save connection first" }, 400);

      // Register global /capture slash command
      const res = await fetch(
        `https://discord.com/api/v10/applications/${conn.application_id}/commands`,
        {
          method: "POST",
          headers: {
            Authorization: `Bot ${conn.bot_token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            name: "capture",
            description: "Capture a thought to your Menerio brain",
            type: 1, // CHAT_INPUT
            options: [
              {
                name: "thought",
                description: "The thought or note to capture",
                type: 3, // STRING
                required: true,
              },
            ],
          }),
        }
      );
      const data = await res.json();
      if (!res.ok) {
        return json({ error: data.message || "Failed to register command", details: data }, res.status);
      }
      return json({ ok: true, command: data });
    }

    if (action === "test") {
      // Send a test message to the capture channel
      if (!conn.discord_channel_id) {
        return json({ error: "No capture channel configured" }, 400);
      }

      const res = await fetch(
        `https://discord.com/api/v10/channels/${conn.discord_channel_id}/messages`,
        {
          method: "POST",
          headers: {
            Authorization: `Bot ${conn.bot_token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            content:
              "🧠 **Menerio is connected!** Send a message here or use `/capture` in any channel to capture thoughts.",
          }),
        }
      );
      if (!res.ok) {
        const data = await res.json();
        return json({ error: data.message || "Failed to send message" }, res.status);
      }
      return json({ ok: true });
    }

    return json({ error: "Unknown action" }, 400);
  }

  // ── Discord Interaction Webhook ──
  const rawBody = await req.text();
  const signature = req.headers.get("x-signature-ed25519");
  const timestamp = req.headers.get("x-signature-timestamp");

  if (!signature || !timestamp) {
    return json({ error: "Missing signature headers" }, 401);
  }

  // Parse the body first to get the interaction type
  let interaction: any;
  try {
    interaction = JSON.parse(rawBody);
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }
  if (!interaction || typeof interaction !== "object") {
    return json({ error: "Invalid JSON" }, 400);
  }

  // Every active connection that claims this interaction's application.
  //
  // application_id and public_key are typed in by the user in Settings and
  // nothing makes them unique, so a second account can save the same pair (the
  // application id is in every invite link and the public key is a verification
  // key, not a secret). This used to be `.single()`: with two such rows it
  // errored, `conn` stayed null, the scan below ran, and the first row whose key
  // verified won, so one account's /capture thoughts could be written into
  // another account. All candidates are collected now, and a tie is settled by
  // which row's bot token actually belongs to the application.
  const appId = typeof interaction.application_id === "string" ? interaction.application_id : null;
  let candidates: any[] = [];

  if (appId) {
    const { data } = await supabase
      .from("discord_connections")
      .select("*")
      .eq("application_id", appId)
      .eq("is_active", true);
    candidates = data ?? [];
  }

  // If no connection is saved under this app_id, try all active connections
  // (a mistyped application id with the right public key still verifies).
  if (candidates.length === 0) {
    const { data: conns } = await supabase
      .from("discord_connections")
      .select("*")
      .eq("is_active", true);
    candidates = conns ?? [];
  }

  const verified = candidates.filter((c) =>
    verifyDiscordSignature(c.public_key, signature, timestamp, rawBody)
  );

  // No saved key signs this request. A PING used to be answered PONG here
  // without any check; an unsigned request now gets 401 whatever its type.
  if (verified.length === 0) {
    return json({ error: "Invalid signature" }, 401);
  }

  // Handle PING - Discord sends this during endpoint URL verification
  if (interaction.type === 1) {
    return json({ type: 1 });
  }

  let conn: any = verified[0];
  if (verified.length > 1) {
    conn = await pickConnectionOwningApplication(verified, appId);
    if (!conn) {
      console.error(
        `discord-capture: ${verified.length} active connections verify for application ${appId}; ` +
          "none (or more than one) is proven by its bot token, so nothing is captured"
      );
      if (interaction.type === 2) {
        return json({
          type: 4,
          data: {
            content: "❌ This Discord app is linked to more than one Menerio account, so nothing was saved. Re-save the connection in Menerio Settings → Integrations → Discord.",
            flags: 64,
          },
        });
      }
      return json({ error: "Ambiguous connection" }, 401);
    }
  }

  try {
    // ── Slash command: /capture ──
    if (interaction.type === 2) {
      const commandName = interaction.data?.name;

      if (commandName === "capture") {
        // /capture is registered as a global command, so Discord delivers it
        // from every server the bot is in and from DMs, by anyone. Nothing
        // checked where it came from: any member of any server with the bot
        // could write notes into the owner's account. Only the server the
        // owner saved in Settings may capture.
        if (!interaction.guild_id || interaction.guild_id !== conn.discord_guild_id) {
          return json({
            type: 4,
            data: {
              content: "❌ /capture only works in the Discord server linked in Menerio (Settings → Integrations → Discord).",
              flags: 64,
            },
          });
        }

        const thought = interaction.data?.options?.find(
          (o: any) => o.name === "thought"
        )?.value;

        if (!thought) {
          return json({
            type: 4, // CHANNEL_MESSAGE_WITH_SOURCE
            data: {
              content: "❌ Please provide a thought to capture.",
              flags: 64, // EPHEMERAL
            },
          });
        }

        // Create the note
        const title =
          thought.slice(0, 50).replace(/\n/g, " ") +
          (thought.length > 50 ? "…" : "");

        const { data: note, error: noteErr } = await supabase
          .from("notes")
          .insert({
            user_id: conn.user_id,
            title,
            content: thought,
            metadata: { is_quick_capture: true, source: "discord" },
          })
          .select("id")
          .single();

        if (noteErr) {
          console.error("Note insert error:", noteErr);
          return json({
            type: 4,
            data: {
              content: "❌ Failed to save note. Please try again.",
              flags: 64,
            },
          });
        }

        // Fire-and-forget process-note
        fetch(`${SUPABASE_URL}/functions/v1/process-note`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
          },
          body: JSON.stringify({ note_id: note.id }),
        }).catch((err) => console.error("process-note error:", err));

        return json({
          type: 4,
          data: {
            content: `✅ **Captured!**\n"${thought.slice(0, 100)}${thought.length > 100 ? "…" : ""}"`,
            flags: 64, // EPHEMERAL
          },
        });
      }
    }

    // ── Channel message (Gateway event via webhook — MESSAGE_CREATE) ──
    // This handles if using Discord's webhook-based event system
    if (interaction.type === 0 || interaction.t === "MESSAGE_CREATE") {
      const message = interaction.d || interaction;
      if (!message?.content || message?.author?.bot) {
        return json({ ok: true });
      }

      // Only capture from designated channel
      if (conn.discord_channel_id && message.channel_id !== conn.discord_channel_id) {
        return json({ ok: true });
      }

      const text = message.content.trim();
      if (!text) return json({ ok: true });

      const title =
        text.slice(0, 50).replace(/\n/g, " ") +
        (text.length > 50 ? "…" : "");

      await supabase.from("notes").insert({
        user_id: conn.user_id,
        title,
        content: text,
        metadata: { is_quick_capture: true, source: "discord" },
      });

      return json({ ok: true });
    }

    return json({ type: 1 }); // Default PONG for unhandled types
  } catch (err) {
    console.error("discord-capture error:", err);
    // A PONG is not a valid answer to a slash command: Discord showed the
    // user only "The application did not respond" and nothing was saved.
    if (interaction.type === 2) {
      return json({
        type: 4,
        data: { content: "❌ Something went wrong and the note was not saved. Please try again.", flags: 64 },
      });
    }
    return json({ type: 1 }); // Always respond to Discord
  }
});
