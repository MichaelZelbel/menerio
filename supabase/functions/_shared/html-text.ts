/**
 * Shared HTML to text helpers.
 *
 * These grew inside `singlefile-capture` (which turns a saved page into a
 * note). `read-url-tool` needs exactly the same extraction, so they live here
 * and both import them, rather than drifting apart as two copies.
 *
 * Conservative by design: this is a search-indexable plain-text body, not
 * perfect article extraction.
 *
 * No Deno APIs, so the Node test runner can import this directly.
 */

/** Decode the common HTML entities that show up in titles and meta tags. */
export function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)));
}

/** Extract the document title. */
export function extractHtmlTitle(html: string): string | null {
  const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (!m) return null;
  const t = decodeEntities(m[1]).replace(/\s+/g, " ").trim();
  return t || null;
}

/** Extract the meta description or the og:description. */
export function extractMetaDescription(html: string): string | null {
  const re =
    /<meta\s+(?:[^>]*?\s)?(?:name|property)\s*=\s*["'](?:description|og:description)["'][^>]*?content\s*=\s*["']([^"']*)["']/i;
  const m = html.match(re);
  if (!m) return null;
  const t = decodeEntities(m[1]).replace(/\s+/g, " ").trim();
  return t || null;
}

/** Extract the canonical URL from a canonical link tag or og:url. */
export function extractCanonicalUrl(html: string): string | null {
  const linkRe =
    /<link\s+[^>]*rel\s*=\s*["']canonical["'][^>]*href\s*=\s*["']([^"']+)["']/i;
  const ogRe =
    /<meta\s+[^>]*property\s*=\s*["']og:url["'][^>]*content\s*=\s*["']([^"']+)["']/i;
  const m = html.match(linkRe) || html.match(ogRe);
  return m ? decodeEntities(m[1]).trim() : null;
}

/**
 * Strip scripts, styles, comments and tags to get readable text.
 *
 * `maxChars` defaults to 50k, which is the note-body budget singlefile-capture
 * has always used. The read_url tool passes a much smaller number, because a
 * model's context is a different budget from a note's.
 */
export function htmlToPlainText(html: string, maxChars = 50_000): string {
  return html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<svg[\s\S]*?<\/svg>/gi, " ")
    .replace(/<head[\s\S]*?<\/head>/gi, " ")
    .replace(/<\/?(p|div|br|li|h[1-6]|tr|article|section)[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .split("\n")
    .map((line) => decodeEntities(line).replace(/[ \t]+/g, " ").trim())
    .filter(Boolean)
    .join("\n")
    .slice(0, maxChars);
}

/** Hostname without a leading www., or null when the URL will not parse. */
export function safeHostname(url: string | undefined | null): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}
