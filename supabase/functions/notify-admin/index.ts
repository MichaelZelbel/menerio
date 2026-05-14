import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const GATEWAY_URL = "https://connector-gateway.lovable.dev/resend";

const ADMIN_EMAIL = Deno.env.get("ADMIN_EMAIL");
if (!ADMIN_EMAIL) {
  throw new Error("ADMIN_EMAIL secret is not configured");
}

const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
if (!LOVABLE_API_KEY) {
  throw new Error("LOVABLE_API_KEY is not configured");
}

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY_1") || Deno.env.get("RESEND_API_KEY");
if (!RESEND_API_KEY) {
  throw new Error("RESEND_API_KEY is not configured");
}

type EventType = "signup" | "delete_account";

interface NotifyRequest {
  eventType: EventType;
  userEmail: string;
  userId?: string;
  displayName?: string;
  metadata?: Record<string, unknown>;
}

const EVENT_CONFIG: Record<EventType, { subjectPrefix: string; emoji: string; description: string }> = {
  signup: {
    subjectPrefix: "New User Signup",
    emoji: "🎉",
    description: "A new user has signed up for Menerio!",
  },
  delete_account: {
    subjectPrefix: "Account Deleted",
    emoji: "🗑️",
    description: "A user has permanently deleted their Menerio account.",
  },
};

function buildEmailHtml(event: EventType, req: NotifyRequest): string {
  const config = EVENT_CONFIG[event];
  const timestamp = new Date().toISOString();

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden;margin-top:32px;margin-bottom:32px;">
    <tr>
      <td style="background:linear-gradient(135deg,#6366f1,#8b5cf6);padding:32px;text-align:center;">
        <h1 style="margin:0;color:#ffffff;font-size:22px;font-weight:700;">Menerio Admin Notification</h1>
      </td>
    </tr>
    <tr>
      <td style="padding:32px;">
        <p style="font-size:16px;color:#18181b;margin:0 0 24px;">
          ${config.emoji} <strong>${config.description}</strong>
        </p>
        <table width="100%" cellpadding="0" cellspacing="0" style="background:#f9fafb;border-radius:8px;padding:4px;">
          <tr><td style="padding:12px 16px;color:#71717a;font-size:13px;border-bottom:1px solid #e4e4e7;">Email</td><td style="padding:12px 16px;color:#18181b;font-size:14px;border-bottom:1px solid #e4e4e7;">${req.userEmail}</td></tr>
          <tr><td style="padding:12px 16px;color:#71717a;font-size:13px;border-bottom:1px solid #e4e4e7;">User ID</td><td style="padding:12px 16px;color:#18181b;font-size:14px;border-bottom:1px solid #e4e4e7;">${req.userId || "N/A"}</td></tr>
          <tr><td style="padding:12px 16px;color:#71717a;font-size:13px;border-bottom:1px solid #e4e4e7;">Display Name</td><td style="padding:12px 16px;color:#18181b;font-size:14px;border-bottom:1px solid #e4e4e7;">${req.displayName || "N/A"}</td></tr>
          <tr><td style="padding:12px 16px;color:#71717a;font-size:13px;">Timestamp</td><td style="padding:12px 16px;color:#18181b;font-size:14px;">${timestamp}</td></tr>
        </table>
      </td>
    </tr>
    <tr>
      <td style="padding:16px 32px 24px;text-align:center;">
        <p style="margin:0;color:#a1a1aa;font-size:12px;">This is an automated notification from Menerio.</p>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // Only trusted server-side callers (DB triggers, other edge functions) may invoke this.
  const authHeader = req.headers.get("Authorization") || "";
  if (!SERVICE_ROLE_KEY || authHeader !== `Bearer ${SERVICE_ROLE_KEY}`) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    console.log("[NOTIFY-ADMIN] Received request");

    const body: NotifyRequest = await req.json();
    const { eventType, userEmail } = body;

    if (!eventType || !userEmail) {
      console.log("[NOTIFY-ADMIN] Missing required fields");
      return new Response(
        JSON.stringify({ error: "eventType and userEmail are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const config = EVENT_CONFIG[eventType];
    if (!config) {
      console.log(`[NOTIFY-ADMIN] Unknown event type: ${eventType}`);
      return new Response(
        JSON.stringify({ error: `Unknown event type: ${eventType}` }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const subject = `${config.emoji} ${config.subjectPrefix}: ${userEmail}`;
    const html = buildEmailHtml(eventType, body);

    console.log(`[NOTIFY-ADMIN] Sending ${eventType} notification for ${userEmail}`);

    const resendResponse = await fetch(`${GATEWAY_URL}/emails`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "X-Connection-Api-Key": RESEND_API_KEY,
      },
      body: JSON.stringify({
        from: "Menerio <support@menerio.com>",
        to: [ADMIN_EMAIL],
        subject,
        html,
      }),
    });

    const resendData = await resendResponse.json();

    if (!resendResponse.ok) {
      console.error(`[NOTIFY-ADMIN] Resend API error [${resendResponse.status}]:`, resendData);
      return new Response(
        JSON.stringify({ error: "Failed to send notification email", details: resendData }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log("[NOTIFY-ADMIN] Email sent successfully:", resendData);

    return new Response(
      JSON.stringify({ success: true, messageId: resendData.id }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[NOTIFY-ADMIN] Error:", message);
    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
