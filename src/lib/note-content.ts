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
 * Coalesce Obsidian/Evernote-style task lists where items are separated by
 * blank lines. CommonMark/GFM treats `- [ ] A\n\n- [ ] B` as two separate
 * lists/paragraphs; Obsidian renders them as a single checklist. We collapse
 * the blank lines between consecutive task-list items so downstream Markdown
 * parsers (tiptap-markdown, our fallback `markdownToHtml`) treat them as
 * one tight task list.
 *
 * Idempotent: already-tight task lists are returned unchanged.
 * Only triggers on `- [ ]` / `- [x]` lines — regular bullet lists are untouched.
 */
export function coalesceTaskList(md: string): string {
  if (!md || !md.includes("[")) return md;

  const TASK_LINE = /^(\s*)- \[[ xX]\]\s+/;
  const lines = md.split("\n");
  const isTask = lines.map((l) => TASK_LINE.test(l));
  const isBlank = lines.map((l) => l.trim() === "");
  const drop = new Set<number>();

  let i = 0;
  while (i < lines.length) {
    if (!isTask[i]) { i++; continue; }
    // Found start of a task run — scan forward, marking blank separators that
    // sit between two task lines for removal.
    let j = i;
    while (j < lines.length) {
      if (isTask[j]) { j++; continue; }
      if (isBlank[j]) {
        // Look ahead past any consecutive blank lines for another task line.
        let k = j;
        while (k < lines.length && isBlank[k]) k++;
        if (k < lines.length && isTask[k]) {
          for (let b = j; b < k; b++) drop.add(b);
          j = k;
          continue;
        }
      }
      break;
    }
    i = j;
  }

  if (drop.size === 0) return md;
  return lines.filter((_, idx) => !drop.has(idx)).join("\n");
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

  // Markdown — coalesce Obsidian-style task lists with blank-line separators.
  if (!looksLikeHtml(value)) {
    return coalesceTaskList(value);
  }

  // Plain HTML — pass through as-is.
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
