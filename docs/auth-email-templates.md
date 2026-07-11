# Auth email templates (Supabase)

**Source of truth:** the Supabase dashboard — Authentication → Emails → Templates
(project `tjeapelvjlmbxafsmjef`). This file is a versioned copy so the templates
survive a dashboard mishap and so contributors can see how the two-brand email
switching works. If you edit a template in the dashboard, update this file in the
same change.

## How brand switching works

Supabase renders these templates with Go's `text/template` engine. Each template
carries both brands and picks one branch per email:

- `{{ .Data.brand }}` reads the `brand` key from the user's `user_metadata`.
  The app writes it at signup (`AuthContext.signUp` passes
  `options.data.brand = BRAND.id`). Users created before 2026-07-11 have no
  `brand` key.
- **Nil-safety:** a missing key makes a bare `eq .Data.brand "x"` comparison
  *error out and break the email*. Always coerce first:
  `eq (printf "%v" .Data.brand) "cherishly"` — a missing key becomes the string
  `"<nil>"` and safely falls to the `else` (Menerio) branch.
- **Signup-confirmation quirk:** at the moment the *Confirm sign up* email
  renders, `.Data` is not yet populated (the metadata is stored, but not
  available to this first email). The confirm template therefore ALSO checks
  `{{ .RedirectTo }}`, which carries the signing-up site's origin
  (`window.location.origin`, no trailing slash). Password-reset and magic-link
  emails render from stored metadata, where `.Data.brand` works.
- **Subject limit:** the dashboard rejects subjects over 255 characters
  (`validate/spam` endpoint returns 400), so subject conditionals must stay
  short — the body has no such limit.

If Cherishly ever changes domains, update the URL list in the confirm-sign-up
condition below (body and subject) in the dashboard and here.

## Confirm sign up

Subject:

```
{{ if or (eq (printf "%v" .Data.brand) "cherishly") (eq .RedirectTo "https://cherishly.ai" "https://www.cherishly.ai") }}Welcome to Cherishly 💗 Confirm your email{{ else }}Welcome to Menerio — Confirm your email{{ end }}
```

Body:

```html
{{ if or (eq (printf "%v" .Data.brand) "cherishly") (eq .RedirectTo "https://cherishly.ai" "https://cherishly.ai/" "https://www.cherishly.ai" "https://www.cherishly.ai/" "https://cherishly-delta.vercel.app") }}<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin:0;padding:0;background-color:#fdf2f6;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#fdf2f6;padding:40px 20px;">
    <tr>
      <td align="center">
        <table width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background-color:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 1px 3px rgba(226,54,112,0.12);">
          <!-- Header -->
          <tr>
            <td style="padding:32px 32px 0;text-align:center;">
              <img src="https://cherishly.ai/apple-touch-icon.png" alt="Cherishly" width="48" height="48" style="border-radius:12px;">
              <h1 style="margin:16px 0 0;font-size:22px;font-weight:700;color:#e23670;">Welcome to Cherishly 💗</h1>
            </td>
          </tr>
          <!-- Body -->
          <tr>
            <td style="padding:24px 32px 32px;">
              <p style="margin:0 0 20px;font-size:15px;line-height:1.6;color:#52525b;">
                Thanks for signing up! Confirm your email to start cherishing the people you love — before the moment fades.
              </p>
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td align="center" style="padding:8px 0 24px;">
                    <a href="{{ .ConfirmationURL }}" target="_blank" style="display:inline-block;padding:12px 32px;background-color:#e23670;color:#ffffff;font-size:15px;font-weight:600;text-decoration:none;border-radius:9999px;">
                      Confirm my email
                    </a>
                  </td>
                </tr>
              </table>
              <p style="margin:0;font-size:13px;line-height:1.5;color:#a1a1aa;">
                If you didn't create an account on Cherishly, you can safely ignore this email.
              </p>
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td style="padding:20px 32px;border-top:1px solid #fdf2f6;text-align:center;">
              <p style="margin:0 0 4px;font-size:12px;color:#a1a1aa;">
                Cherishly is powered by <a href="https://menerio.com" style="color:#a1a1aa;text-decoration:underline;">Menerio</a> — one account works on both.
              </p>
              <p style="margin:0;font-size:12px;color:#a1a1aa;">
                © 2026 Cherishly · <a href="https://cherishly.ai/privacy" style="color:#a1a1aa;text-decoration:underline;">Privacy</a>
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
{{ else }}<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin:0;padding:0;background-color:#f4f4f5;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f4f5;padding:40px 20px;">
    <tr>
      <td align="center">
        <table width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background-color:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.08);">
          <!-- Header -->
          <tr>
            <td style="padding:32px 32px 0;text-align:center;">
              <div style="display:inline-block;width:40px;height:40px;background-color:#18181b;border-radius:10px;line-height:40px;color:#ffffff;font-weight:700;font-size:18px;text-align:center;">M</div>
              <h1 style="margin:16px 0 0;font-size:22px;font-weight:700;color:#18181b;">Welcome to Menerio</h1>
            </td>
          </tr>
          <!-- Body -->
          <tr>
            <td style="padding:24px 32px 32px;">
              <p style="margin:0 0 20px;font-size:15px;line-height:1.6;color:#52525b;">
                Thanks for signing up! Confirm your email to start capturing and connecting your thoughts with AI.
              </p>
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td align="center" style="padding:8px 0 24px;">
                    <a href="{{ .ConfirmationURL }}" target="_blank" style="display:inline-block;padding:12px 32px;background-color:#18181b;color:#ffffff;font-size:15px;font-weight:600;text-decoration:none;border-radius:8px;">
                      Confirm my email
                    </a>
                  </td>
                </tr>
              </table>
              <p style="margin:0;font-size:13px;line-height:1.5;color:#a1a1aa;">
                If you didn't create an account on Menerio, you can safely ignore this email.
              </p>
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td style="padding:20px 32px;border-top:1px solid #f4f4f5;text-align:center;">
              <p style="margin:0;font-size:12px;color:#a1a1aa;">
                © 2026 Menerio · <a href="https://menerio.com/privacy" style="color:#a1a1aa;text-decoration:underline;">Privacy</a>
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
{{ end }}
```

## Reset password

Subject:

```
{{ if eq (printf "%v" .Data.brand) "cherishly" }}Reset your Cherishly password 💗{{ else }}Reset your Menerio password{{ end }}
```

Body: same two-card structure as Confirm sign up, with the simple
`{{ if eq (printf "%v" .Data.brand) "cherishly" }}` condition (stored metadata is
available here), headline "Reset your password", copy "Follow the link below to
set a new password for your Cherishly/Menerio account.", button
"Reset my password" → `{{ .ConfirmationURL }}`, and the ignore line
"If you didn't request a password reset, you can safely ignore this email."

## Magic link or OTP

Subject:

```
{{ if eq (printf "%v" .Data.brand) "cherishly" }}Your Cherishly sign-in link 💗{{ else }}Your Menerio sign-in link{{ end }}
```

Body: same structure, headline "Your sign-in link", button "Sign me in" →
`{{ .ConfirmationURL }}`.

## Known limitation

The SMTP sender is one per Supabase project: all auth emails are sent as
"Menerio <support@menerio.com>" (via Resend SMTP) regardless of brand. A
per-brand From address requires the Supabase **Send Email Hook** (an edge
function sending via the Resend API) — planned together with brand-aware
backend emails (daily digest etc.).
