const ESCAPED_HTML_TAG_PATTERN = /&lt;\/?(?:p|h[1-6]|ul|ol|li|blockquote|pre|code|a|img|table|thead|tbody|tr|td|th|br|strong|em|u|s)\b/i;
const BLOCK_HTML_TAG_PATTERN = /<(?:p|h[1-6]|ul|ol|li|blockquote|pre|img|table)\b/i;

/** Returns true when content looks like HTML (has block-level tags) */
export function looksLikeHtml(content: string): boolean {
  return BLOCK_HTML_TAG_PATTERN.test(content);
}

function decodeHtmlEntities(value: string): string {
  if (typeof document === "undefined") return value;

  const textarea = document.createElement("textarea");
  textarea.innerHTML = value;
  return textarea.value;
}

/**
 * Normalize note content for the TipTap editor.
 * Handles both legacy HTML content and new Markdown content.
 * TipTap's markdown extension auto-detects format via setContent().
 */
export function normalizeNoteContent(content: string | null | undefined): string {
  const value = content ?? "";
  if (!value) return value;

  // Legacy HTML with escaped entities — decode them
  if (ESCAPED_HTML_TAG_PATTERN.test(value)) {
    const decoded = decodeHtmlEntities(value);
    const wrappedMatch = decoded.match(/^<p>([\s\S]*)<\/p>$/i);
    if (wrappedMatch && BLOCK_HTML_TAG_PATTERN.test(wrappedMatch[1])) {
      return wrappedMatch[1];
    }
    return decoded;
  }

  // Markdown or plain HTML — pass through as-is (TipTap handles both)
  return value;
}

/**
 * Strip a leading H1 from HTML content if its text matches the note title.
 * Prevents the doubled-headline problem for synced notes.
 * Also handles Markdown "# Title" format.
 */
export function stripLeadingH1(html: string, title: string): string {
  if (!html || !title) return html;

  // HTML H1
  const htmlMatch = html.match(/^<h1[^>]*>([\s\S]*?)<\/h1>\s*/i);
  if (htmlMatch) {
    const h1Text = htmlMatch[1].replace(/<[^>]+>/g, "").trim();
    if (h1Text.toLowerCase() === title.trim().toLowerCase()) {
      return html.slice(htmlMatch[0].length);
    }
  }

  // Markdown H1
  const mdMatch = html.match(/^#\s+(.+)\n*/);
  if (mdMatch) {
    if (mdMatch[1].trim().toLowerCase() === title.trim().toLowerCase()) {
      return html.slice(mdMatch[0].length);
    }
  }

  return html;
}

/** Strip markdown syntax to produce plain text */
function stripMarkdown(md: string): string {
  let text = md;
  // Remove code blocks
  text = text.replace(/```[\s\S]*?```/g, " ");
  // Remove inline code
  text = text.replace(/`([^`]+)`/g, "$1");
  // Remove images
  text = text.replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1");
  // Remove links, keep text
  text = text.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1");
  // Remove headings markers
  text = text.replace(/^#{1,6}\s+/gm, "");
  // Remove bold/italic
  text = text.replace(/\*{1,3}(.+?)\*{1,3}/g, "$1");
  // Remove strikethrough
  text = text.replace(/~~(.+?)~~/g, "$1");
  // Remove highlight
  text = text.replace(/==(.+?)==/g, "$1");
  // Remove blockquotes
  text = text.replace(/^>\s?/gm, "");
  // Remove horizontal rules
  text = text.replace(/^(-{3,}|_{3,}|\*{3,})$/gm, "");
  // Remove list markers
  text = text.replace(/^[-*+]\s+/gm, "");
  text = text.replace(/^\d+\.\s+/gm, "");
  // Remove task list markers
  text = text.replace(/^- \[[ x]\]\s*/gm, "");
  return text;
}

export function getNotePreviewText(content: string | null | undefined, maxLen = 80): string {
  const normalized = normalizeNoteContent(content);
  if (!normalized) return "No content";

  let text: string;

  if (looksLikeHtml(normalized)) {
    // Legacy HTML content
    text = typeof DOMParser !== "undefined"
      ? new DOMParser().parseFromString(normalized, "text/html").body.textContent ?? ""
      : normalized.replace(/<[^>]+>/g, " ");
  } else {
    // Markdown content
    text = stripMarkdown(normalized);
  }

  const collapsed = text.replace(/\s+/g, " ").trim();
  if (!collapsed) return "No content";

  return collapsed.length > maxLen ? `${collapsed.slice(0, maxLen)}…` : collapsed;
}
