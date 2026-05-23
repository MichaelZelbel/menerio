## Goal
Get `https://menerio.com/` verified in Google Search Console so it shows up as a property and starts collecting indexing/search data.

## Why the meta-tag method
Lovable-hosted apps can't use DNS, file-upload, or Analytics verification reliably. The `META` method works: we drop a `<meta name="google-site-verification" content="...">` into `index.html`, deploy, then ask Google to verify.

## Steps

1. **Request a verification token from Google** (via the Search Console connector gateway) for the identifier `https://menerio.com/`. Google returns the exact `content` value to use.

2. **Add the meta tag to `index.html`** inside `<head>`:
   ```html
   <meta name="google-site-verification" content="<TOKEN>" />
   ```

3. **You republish** so the tag is live on `https://menerio.com/`. (Frontend changes only go live after Publish → Update.)

4. **Trigger Google's verification check** through the gateway. A 200 means verified. If it fails with `failedToFindMetaTag`, we re-check the deploy.

5. **Add the verified site to Search Console** so it appears in your property list and starts collecting data.

6. **Optional follow-up:** submit `https://menerio.com/sitemap.xml` via the Sitemaps API so indexing kicks off immediately.

## What you need to do
- Confirm `menerio.com` is the domain to verify (not `www.menerio.com` or the `.lovable.app` URL).
- After I add the meta tag, click **Publish → Update** so the change is live before I trigger verification.

## Technical details
- Gateway: `https://connector-gateway.lovable.dev/google_search_console`
- Uses your already-connected `GOOGLE_SEARCH_CONSOLE_API_KEY`
- Only file edited: `index.html` (one meta tag added in `<head>`)
- No code changes outside that single tag
