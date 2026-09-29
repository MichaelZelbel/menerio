// Where Google may send a Drive authorization code: the app's own callback
// page, on a site that serves the app. Pure, so vitest can import it.

const APP_HOSTS = new Set(["menerio.com", "www.menerio.com", "cherishly.ai", "www.cherishly.ai"]);
// Lovable's published site and its editor previews.
const PREVIEW_HOST = /^[a-z0-9-]+\.(lovable\.app|lovableproject\.com)$/;
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1"]);

export function isAllowedReturnUrl(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.username || url.password) return false;
  if (url.pathname !== "/gdrive-callback") return false;
  const host = url.hostname.toLowerCase();
  if (url.protocol === "http:") return LOCAL_HOSTS.has(host);
  if (url.protocol !== "https:") return false;
  return APP_HOSTS.has(host) || PREVIEW_HOST.test(host) || LOCAL_HOSTS.has(host);
}
