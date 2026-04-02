const ESCAPED_HTML_TAG_PATTERN = /&lt;\/?(?:p|h[1-6]|ul|ol|li|blockquote|pre|code|a|img|table|thead|tbody|tr|td|th|br|strong|em|u|s)\b/i;
const BLOCK_HTML_TAG_PATTERN = /<(?:p|h[1-6]|ul|ol|li|blockquote|pre|img|table)\b/i;

function decodeHtmlEntities(value: string): string {
  if (typeof document === "undefined") return value;

  const textarea = document.createElement("textarea");
  textarea.innerHTML = value;
  return textarea.value;
}

export function normalizeNoteContent(content: string | null | undefined): string {
  const value = content ?? "";
  if (!value || !ESCAPED_HTML_TAG_PATTERN.test(value)) return value;

  const decoded = decodeHtmlEntities(value);
  const wrappedMatch = decoded.match(/^<p>([\s\S]*)<\/p>$/i);

  if (wrappedMatch && BLOCK_HTML_TAG_PATTERN.test(wrappedMatch[1])) {
    return wrappedMatch[1];
  }

  return decoded;
}

/**
 * Strip a leading H1 from HTML content if its text matches the note title.
 * Prevents the doubled-headline problem for synced notes.
 */
export function stripLeadingH1(html: string, title: string): string {
  if (!html || !title) return html;
  const match = html.match(/^<h1[^>]*>([\s\S]*?)<\/h1>\s*/i);
  if (!match) return html;
  const h1Text = match[1].replace(/<[^>]+>/g, "").trim();
  if (h1Text.toLowerCase() === title.trim().toLowerCase()) {
    return html.slice(match[0].length);
  }
  return html;
}

export function getNotePreviewText(content: string | null | undefined, maxLen = 80): string {
  const normalized = normalizeNoteContent(content);

  if (!normalized) return "No content";

  const text = typeof DOMParser !== "undefined"
    ? new DOMParser().parseFromString(normalized, "text/html").body.textContent ?? ""
    : normalized.replace(/<[^>]+>/g, " ");

  const collapsed = text.replace(/\s+/g, " ").trim();
  if (!collapsed) return "No content";

  return collapsed.length > maxLen ? `${collapsed.slice(0, maxLen)}…` : collapsed;
}
