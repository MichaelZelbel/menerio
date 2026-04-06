# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability in Menerio, please report it responsibly.

**Email:** security@menerio.com

Please include:

- A description of the vulnerability
- Steps to reproduce it
- Any potential impact you've identified

We will acknowledge your report within **3 business days** and aim to provide a fix or mitigation plan within **14 days**.

## Scope

This policy covers the Menerio web application and its Supabase Edge Functions. Third-party services (e.g. Supabase infrastructure itself) are out of scope — please report those to the respective provider.

## Responsible Disclosure

- Do not publicly disclose the vulnerability until we have addressed it.
- Do not access or modify other users' data.
- Act in good faith to avoid privacy violations and disruption of service.

## Not a Vulnerability

The following are generally **not** considered vulnerabilities:

- Missing rate limiting on non-sensitive endpoints
- Clickjacking on pages with no sensitive actions
- Information disclosed in `.env.example` (these are intentional placeholders)

Thank you for helping keep Menerio safe.
