// Send Email Auth Hook — replaces Supabase's built-in auth mailer.
//
// Supabase Auth calls this function (signed with SEND_EMAIL_HOOK_SECRET,
// standardwebhooks format) for every auth email: signup confirmation,
// password recovery, magic link, invite, email change, reauthentication.
// We render a brand-aware email (Menerio vs Cherishly — see docs/BRANDING.md)
// and send it through the Resend API with a per-brand From address, which
// SMTP-based sending cannot do (one sender per Supabase project).
//
// Brand resolution mirrors the (still configured, now fallback-only)
// dashboard templates: user_metadata.brand first, then the redirect_to origin.
// If the hook is disabled in the dashboard, Supabase falls back to SMTP +
// the dashboard templates documented in docs/auth-email-templates.md.
//
// Rollback: Dashboard → Authentication → Auth Hooks → disable "Send Email".
import { Webhook } from "https://esm.sh/standardwebhooks@1.0.0";

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") ?? "";
const HOOK_SECRET = (Deno.env.get("SEND_EMAIL_HOOK_SECRET") ?? "").replace("v1,whsec_", "");
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

interface BrandTheme {
  id: "menerio" | "cherishly";
  name: string;
  from: string;
  url: string;
  bg: string;
  cardRadius: string;
  accent: string;
  btnRadius: string;
  shadow: string;
  logoHtml: string;
  footerHtml: string;
}

const MENERIO: BrandTheme = {
  id: "menerio",
  name: "Menerio",
  from: "Menerio <support@menerio.com>",
  url: "https://menerio.com",
  bg: "#f4f4f5",
  cardRadius: "12px",
  accent: "#18181b",
  btnRadius: "8px",
  shadow: "0 1px 3px rgba(0,0,0,0.08)",
  logoHtml:
    '<div style="display:inline-block;width:40px;height:40px;background-color:#18181b;border-radius:10px;line-height:40px;color:#ffffff;font-weight:700;font-size:18px;text-align:center;">M</div>',
  footerHtml:
    '<p style="margin:0;font-size:12px;color:#a1a1aa;">© 2026 Menerio · <a href="https://menerio.com/privacy" style="color:#a1a1aa;text-decoration:underline;">Privacy</a></p>',
};

const CHERISHLY: BrandTheme = {
  id: "cherishly",
  name: "Cherishly",
  from: "Cherishly <support@cherishly.ai>",
  url: "https://cherishly.ai",
  bg: "#fdf2f6",
  cardRadius: "16px",
  accent: "#e23670",
  btnRadius: "9999px",
  shadow: "0 1px 3px rgba(226,54,112,0.12)",
  logoHtml:
    '<img src="https://cherishly.ai/apple-touch-icon.png" alt="Cherishly" width="48" height="48" style="border-radius:12px;">',
  footerHtml:
    '<p style="margin:0 0 4px;font-size:12px;color:#a1a1aa;">Cherishly is powered by <a href="https://menerio.com" style="color:#a1a1aa;text-decoration:underline;">Menerio</a> — one account works on both.</p>' +
    '<p style="margin:0;font-size:12px;color:#a1a1aa;">© 2026 Cherishly · <a href="https://cherishly.ai/privacy" style="color:#a1a1aa;text-decoration:underline;">Privacy</a></p>',
};

const CHERISHLY_HOSTS = new Set([
  "cherishly.ai",
  "www.cherishly.ai",
  "cherishly-delta.vercel.app",
]);

function resolveBrand(userMetadata: Record<string, unknown> | undefined, redirectTo: string): BrandTheme {
  if (userMetadata?.brand === "cherishly") return CHERISHLY;
  if (userMetadata?.brand === "menerio") return MENERIO;
  try {
    if (CHERISHLY_HOSTS.has(new URL(redirectTo).host)) return CHERISHLY;
  } catch {
    // unparsable/empty redirect_to → default brand
  }
  return MENERIO;
}

interface EmailContent {
  subject: string;
  heading: string;
  paragraph: string;
  buttonLabel: string | null; // null → token-code email (reauthentication)
  ignoreLine: string;
}

function contentFor(actionType: string, brand: BrandTheme): EmailContent {
  const heart = brand.id === "cherishly" ? " 💗" : "";
  // Signup subject separator: heart for Cherishly, em dash for Menerio
  // (matches the pre-hook subject "Welcome to Menerio — Confirm your email").
  const sep = brand.id === "cherishly" ? " 💗" : " —";
  switch (actionType) {
    case "signup":
      return {
        subject: `Welcome to ${brand.name}${sep} Confirm your email`,
        heading: `Welcome to ${brand.name}${heart}`,
        paragraph:
          brand.id === "cherishly"
            ? "Thanks for signing up! Confirm your email to start cherishing the people you love — before the moment fades."
            : "Thanks for signing up! Confirm your email to start capturing and connecting your thoughts with AI.",
        buttonLabel: "Confirm my email",
        ignoreLine: `If you didn't create an account on ${brand.name}, you can safely ignore this email.`,
      };
    case "recovery":
      return {
        subject: `Reset your ${brand.name} password${heart}`,
        heading: "Reset your password",
        paragraph: `Follow the link below to set a new password for your ${brand.name} account.`,
        buttonLabel: "Reset my password",
        ignoreLine: "If you didn't request a password reset, you can safely ignore this email.",
      };
    case "magiclink":
      return {
        subject: `Your ${brand.name} sign-in link${heart}`,
        heading: "Your sign-in link",
        paragraph: `Follow the link below to sign in to your ${brand.name} account.`,
        buttonLabel: "Sign me in",
        ignoreLine: "If you didn't request this link, you can safely ignore this email.",
      };
    case "invite":
      return {
        subject: `You've been invited to ${brand.name}${heart}`,
        heading: `Join ${brand.name}`,
        paragraph: `You have been invited to create an account on ${brand.name}. Follow the link below to accept the invitation.`,
        buttonLabel: "Accept invitation",
        ignoreLine: "If you weren't expecting this invitation, you can safely ignore this email.",
      };
    case "email_change":
    case "email_change_current":
    case "email_change_new":
      return {
        subject: `Confirm your new email for ${brand.name}`,
        heading: "Confirm your email change",
        paragraph: `Follow the link below to confirm the email change for your ${brand.name} account.`,
        buttonLabel: "Confirm email change",
        ignoreLine: "If you didn't request this change, please review your account security.",
      };
    case "reauthentication":
      return {
        subject: `Your ${brand.name} verification code`,
        heading: "Your verification code",
        paragraph: `Enter this code in ${brand.name} to confirm it's you:`,
        buttonLabel: null,
        ignoreLine: "If you didn't request this code, you can safely ignore this email.",
      };
    default:
      return {
        subject: `Confirm this action on ${brand.name}`,
        heading: "Confirm this action",
        paragraph: `Follow the link below to continue on ${brand.name}.`,
        buttonLabel: "Continue",
        ignoreLine: "If you didn't request this, you can safely ignore this email.",
      };
  }
}

function renderHtml(brand: BrandTheme, c: EmailContent, actionUrl: string | null, token: string | null): string {
  const action = c.buttonLabel && actionUrl
    ? `<table width="100%" cellpadding="0" cellspacing="0">
        <tr>
          <td align="center" style="padding:8px 0 24px;">
            <a href="${actionUrl}" target="_blank" style="display:inline-block;padding:12px 32px;background-color:${brand.accent};color:#ffffff;font-size:15px;font-weight:600;text-decoration:none;border-radius:${brand.btnRadius};">
              ${c.buttonLabel}
            </a>
          </td>
        </tr>
      </table>`
    : `<p style="margin:0 0 24px;text-align:center;font-size:28px;font-weight:700;letter-spacing:6px;color:${brand.accent};">${token ?? ""}</p>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin:0;padding:0;background-color:${brand.bg};font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color:${brand.bg};padding:40px 20px;">
    <tr>
      <td align="center">
        <table width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background-color:#ffffff;border-radius:${brand.cardRadius};overflow:hidden;box-shadow:${brand.shadow};">
          <tr>
            <td style="padding:32px 32px 0;text-align:center;">
              ${brand.logoHtml}
              <h1 style="margin:16px 0 0;font-size:22px;font-weight:700;color:${brand.accent};">${c.heading}</h1>
            </td>
          </tr>
          <tr>
            <td style="padding:24px 32px 32px;">
              <p style="margin:0 0 20px;font-size:15px;line-height:1.6;color:#52525b;">${c.paragraph}</p>
              ${action}
              <p style="margin:0;font-size:13px;line-height:1.5;color:#a1a1aa;">${c.ignoreLine}</p>
            </td>
          </tr>
          <tr>
            <td style="padding:20px 32px;border-top:1px solid ${brand.bg};text-align:center;">
              ${brand.footerHtml}
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

async function sendViaResend(payload: {
  from: string;
  to: string[];
  subject: string;
  html: string;
  text: string;
}): Promise<{ ok: boolean; status: number; body: string }> {
  const resp = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  return { ok: resp.ok, status: resp.status, body: await resp.text() };
}

Deno.serve(async (req: Request): Promise<Response> => {
  // Ops helper: list the Resend account's verified domains.
  // GET ?debug=domains, service-role protected.
  if (req.method === "GET") {
    const url = new URL(req.url);
    if (url.searchParams.get("debug") === "domains") {
      const auth = req.headers.get("Authorization") ?? "";
      if (!SERVICE_ROLE_KEY || auth !== `Bearer ${SERVICE_ROLE_KEY}`) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
      }
      const resp = await fetch("https://api.resend.com/domains", {
        headers: { Authorization: `Bearer ${RESEND_API_KEY}` },
      });
      return new Response(await resp.text(), {
        status: resp.status,
        headers: { "Content-Type": "application/json" },
      });
    }
    return new Response(JSON.stringify({ error: "Not found" }), { status: 404 });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405 });
  }

  // Verify the standardwebhooks signature from Supabase Auth.
  const rawPayload = await req.text();
  let data: {
    user: { email: string; new_email?: string; user_metadata?: Record<string, unknown> };
    email_data: {
      token: string;
      token_hash: string;
      token_new?: string;
      token_hash_new?: string;
      redirect_to: string;
      email_action_type: string;
      site_url: string;
    };
  };
  try {
    const wh = new Webhook(HOOK_SECRET);
    data = wh.verify(rawPayload, {
      "webhook-id": req.headers.get("webhook-id") ?? "",
      "webhook-timestamp": req.headers.get("webhook-timestamp") ?? "",
      "webhook-signature": req.headers.get("webhook-signature") ?? "",
    }) as typeof data;
  } catch (err) {
    console.error("[SEND-AUTH-EMAIL] Signature verification failed:", err);
    return new Response(JSON.stringify({ error: "Invalid signature" }), { status: 401 });
  }

  const { user, email_data } = data;
  const actionType = email_data.email_action_type;
  const brand = resolveBrand(user.user_metadata, email_data.redirect_to);
  const content = contentFor(actionType, brand);

  // Same verify-link shape Supabase's built-in {{ .ConfirmationURL }} produces.
  const actionUrl =
    `${SUPABASE_URL}/auth/v1/verify?token=${encodeURIComponent(email_data.token_hash)}` +
    `&type=${encodeURIComponent(actionType)}&redirect_to=${encodeURIComponent(email_data.redirect_to)}`;

  // email_change_new confirms the NEW address; everything else goes to the
  // account's current email.
  const to = actionType === "email_change_new" && user.new_email ? user.new_email : user.email;

  const html = renderHtml(brand, content, content.buttonLabel ? actionUrl : null, email_data.token);
  const text = content.buttonLabel
    ? `${content.heading}\n\n${content.paragraph}\n\n${content.buttonLabel}: ${actionUrl}\n\n${content.ignoreLine}`
    : `${content.heading}\n\n${content.paragraph} ${email_data.token}\n\n${content.ignoreLine}`;

  let result = await sendViaResend({ from: brand.from, to: [to], subject: content.subject, html, text });

  // If the brand's From domain is not verified in this Resend account,
  // retry once with the Menerio sender so the email still arrives.
  if (!result.ok && brand.id !== "menerio") {
    console.error(
      `[SEND-AUTH-EMAIL] Send as "${brand.from}" failed (${result.status}): ${result.body} — retrying with Menerio sender`,
    );
    result = await sendViaResend({ from: MENERIO.from, to: [to], subject: content.subject, html, text });
  }

  if (!result.ok) {
    console.error(`[SEND-AUTH-EMAIL] Resend error ${result.status}: ${result.body}`);
    return new Response(JSON.stringify({ error: "Email send failed" }), { status: 500 });
  }

  console.log(`[SEND-AUTH-EMAIL] Sent ${actionType} email, brand=${brand.id}`);
  return new Response(JSON.stringify({}), { status: 200, headers: { "Content-Type": "application/json" } });
});
