import matter from "gray-matter";

// ─── Types ───────────────────────────────────────────────────────────

export interface NoteForExport {
  id: string;
  title: string;
  content: string; // HTML from Tiptap
  metadata: Record<string, unknown> | null;
  tags: string[];
  created_at: string;
  updated_at: string;
  is_favorite?: boolean;
  is_pinned?: boolean;
  entity_type?: string | null;
}

export interface ParsedMarkdownNote {
  id?: string;
  title: string;
  content: string; // HTML for Tiptap
  metadata: Record<string, unknown>;
  tags: string[];
  created_at?: string;
  updated_at?: string;
  entity_type?: string | null;
}

// ─── HTML ↔ Markdown primitives ───────────────────────────────────────

/**
 * Convert Tiptap HTML to Markdown.
 *
 * We do this with a lightweight regex-based transform because the
 * tiptap-markdown serialiser lives inside the editor instance and
 * can't be used outside of React easily.  The edge-function / test
 * context has no DOM either, so we keep it dependency-free.
 */
export function htmlToMarkdown(html: string): string {
  if (!html || !html.trim()) return "";

  let md = html;

  // Preserve hard breaks before block-level processing
  md = md.replace(/<br\s*\/?>/gi, "  \n");

  // Headings
  md = md.replace(/<h1[^>]*>([\s\S]*?)<\/h1>/gi, (_, c) => `# ${inlineHtml(c)}\n\n`);
  md = md.replace(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, (_, c) => `## ${inlineHtml(c)}\n\n`);
  md = md.replace(/<h3[^>]*>([\s\S]*?)<\/h3>/gi, (_, c) => `### ${inlineHtml(c)}\n\n`);
  md = md.replace(/<h4[^>]*>([\s\S]*?)<\/h4>/gi, (_, c) => `#### ${inlineHtml(c)}\n\n`);
  md = md.replace(/<h5[^>]*>([\s\S]*?)<\/h5>/gi, (_, c) => `##### ${inlineHtml(c)}\n\n`);
  md = md.replace(/<h6[^>]*>([\s\S]*?)<\/h6>/gi, (_, c) => `###### ${inlineHtml(c)}\n\n`);

  // Horizontal rules
  md = md.replace(/<hr\s*\/?>/gi, "\n---\n\n");

  // Blockquotes (simple single-level)
  md = md.replace(/<blockquote[^>]*>([\s\S]*?)<\/blockquote>/gi, (_, c) => {
    const inner = htmlToMarkdown(c).trim();
    return inner.split("\n").map((l) => `> ${l}`).join("\n") + "\n\n";
  });

  // Code blocks
  md = md.replace(/<pre[^>]*><code(?:\s+class="language-(\w+)")?[^>]*>([\s\S]*?)<\/code><\/pre>/gi, (_, lang, code) => {
    return `\`\`\`${lang || ""}\n${decodeEntities(code).trimEnd()}\n\`\`\`\n\n`;
  });

  // Task lists
  md = md.replace(/<ul[^>]*data-type="taskList"[^>]*>([\s\S]*?)<\/ul>/gi, (_, items) => {
    return items.replace(/<li[^>]*data-checked="(true|false)"[^>]*>([\s\S]*?)<\/li>/gi, (_m: string, checked: string, text: string) => {
      const checkbox = checked === "true" ? "[x]" : "[ ]";
      return `- ${checkbox} ${inlineHtml(stripTags(text, "p", "label", "div")).trim()}\n`;
    }) + "\n";
  });

  // Unordered lists
  md = md.replace(/<ul[^>]*>([\s\S]*?)<\/ul>/gi, (_, items) => {
    return items.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, (_m: string, text: string) => {
      return `- ${inlineHtml(stripTags(text, "p")).trim()}\n`;
    }) + "\n";
  });

  // Ordered lists
  md = md.replace(/<ol[^>]*>([\s\S]*?)<\/ol>/gi, (_, items) => {
    let idx = 0;
    return items.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, (_m: string, text: string) => {
      idx++;
      return `${idx}. ${inlineHtml(stripTags(text, "p")).trim()}\n`;
    }) + "\n";
  });

  // Tables
  md = md.replace(/<table[^>]*>([\s\S]*?)<\/table>/gi, (_, tableHtml) => {
    const rows: string[][] = [];
    const rowMatches = tableHtml.match(/<tr[^>]*>([\s\S]*?)<\/tr>/gi) || [];
    for (const rowHtml of rowMatches) {
      const cells: string[] = [];
      const cellMatches = rowHtml.match(/<(?:td|th)[^>]*>([\s\S]*?)<\/(?:td|th)>/gi) || [];
      for (const cellHtml of cellMatches) {
        const content = cellHtml.replace(/<\/?(?:td|th)[^>]*>/gi, "");
        cells.push(inlineHtml(content).trim());
      }
      rows.push(cells);
    }
    if (rows.length === 0) return "";
    const colCount = Math.max(...rows.map((r) => r.length));
    const pad = (cells: string[]) => {
      while (cells.length < colCount) cells.push("");
      return `| ${cells.join(" | ")} |`;
    };
    const header = pad(rows[0]);
    const sep = `| ${Array(colCount).fill("---").join(" | ")} |`;
    const body = rows.slice(1).map(pad).join("\n");
    return `${header}\n${sep}\n${body}\n\n`;
  });

  // Images
  md = md.replace(/<img[^>]*src="([^"]*)"[^>]*alt="([^"]*)"[^>]*\/?>/gi, (_, src, alt) => `![${alt}](${src})`);
  md = md.replace(/<img[^>]*src="([^"]*)"[^>]*\/?>/gi, (_, src) => `![](${src})`);

  // Links
  md = md.replace(/<a[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, (_, href, text) => `[${inlineHtml(text)}](${href})`);

  // Inline formatting
  md = md.replace(/<(?:strong|b)>([\s\S]*?)<\/(?:strong|b)>/gi, (_, c) => `**${c}**`);
  md = md.replace(/<(?:em|i)>([\s\S]*?)<\/(?:em|i)>/gi, (_, c) => `*${c}*`);
  md = md.replace(/<(?:del|s|strike)>([\s\S]*?)<\/(?:del|s|strike)>/gi, (_, c) => `~~${c}~~`);
  md = md.replace(/<code>([\s\S]*?)<\/code>/gi, (_, c) => `\`${decodeEntities(c)}\``);
  md = md.replace(/<u>([\s\S]*?)<\/u>/gi, (_, c) => `<u>${c}</u>`); // no MD equivalent
  md = md.replace(/<sup>([\s\S]*?)<\/sup>/gi, (_, c) => `<sup>${c}</sup>`);
  md = md.replace(/<sub>([\s\S]*?)<\/sub>/gi, (_, c) => `<sub>${c}</sub>`);
  md = md.replace(/<mark[^>]*>([\s\S]*?)<\/mark>/gi, (_, c) => `==${c}==`);

  // Paragraphs → double newlines
  md = md.replace(/<p[^>]*>([\s\S]*?)<\/p>/gi, (_, c) => `${inlineHtml(c)}\n\n`);

  // Strip remaining tags
  md = md.replace(/<[^>]+>/g, "");

  // Decode entities
  md = decodeEntities(md);

  // Normalise whitespace: collapse 3+ consecutive newlines to 2
  md = md.replace(/\n{3,}/g, "\n\n");

  return md.trim() + "\n";
}

/**
 * Convert Markdown back to Tiptap-compatible HTML.
 */
export function markdownToHtml(md: string): string {
  if (!md) return "";

  let html = md;

  // Code blocks (must be first to avoid inner processing)
  const codeBlocks: string[] = [];
  html = html.replace(/```(\w*)\n([\s\S]*?)```/g, (_, lang, code) => {
    const idx = codeBlocks.length;
    const langAttr = lang ? ` class="language-${lang}"` : "";
    codeBlocks.push(`<pre><code${langAttr}>${encodeEntities(code.trimEnd())}</code></pre>`);
    return `%%CODEBLOCK_${idx}%%`;
  });

  // Inline code (protect from further processing)
  const inlineCodes: string[] = [];
  html = html.replace(/`([^`]+)`/g, (_, code) => {
    const idx = inlineCodes.length;
    inlineCodes.push(`<code>${encodeEntities(code)}</code>`);
    return `%%INLINECODE_${idx}%%`;
  });

  // Split into blocks by double newlines
  const blocks = html.split(/\n{2,}/);
  const processedBlocks: string[] = [];

  for (const block of blocks) {
    const trimmed = block.trim();
    if (!trimmed) continue;

    // Code block placeholder
    if (trimmed.match(/^%%CODEBLOCK_\d+%%$/)) {
      const idx = parseInt(trimmed.match(/\d+/)![0]);
      processedBlocks.push(codeBlocks[idx]);
      continue;
    }

    // Horizontal rule
    if (/^(-{3,}|_{3,}|\*{3,})$/.test(trimmed)) {
      processedBlocks.push("<hr>");
      continue;
    }

    // Headings
    const headingMatch = trimmed.match(/^(#{1,6})\s+(.+)$/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      processedBlocks.push(`<h${level}>${inlineMarkdown(headingMatch[2])}</h${level}>`);
      continue;
    }

    // Table
    if (trimmed.includes("|") && trimmed.includes("---")) {
      const rows = trimmed.split("\n").filter((r) => r.trim());
      if (rows.length >= 2) {
        const parseRow = (row: string) =>
          row.split("|").map((c) => c.trim()).filter((_, i, arr) => i > 0 && i < arr.length);
        const isSep = (row: string) => /^\|?\s*-{3,}/.test(row);

        let tableHtml = "<table><tbody>";
        let headerDone = false;
        for (const row of rows) {
          if (isSep(row)) { headerDone = true; continue; }
          const cells = parseRow(row);
          const tag = !headerDone ? "th" : "td";
          if (!headerDone) tableHtml = tableHtml.replace("<tbody>", "<thead>");
          tableHtml += "<tr>" + cells.map((c) => `<${tag}>${inlineMarkdown(c)}</${tag}>`).join("") + "</tr>";
          if (!headerDone) { tableHtml += "</thead><tbody>"; headerDone = true; }
        }
        tableHtml += "</tbody></table>";
        processedBlocks.push(tableHtml);
        continue;
      }
    }

    // Blockquote
    if (trimmed.startsWith(">")) {
      const inner = trimmed.split("\n").map((l) => l.replace(/^>\s?/, "")).join("\n");
      processedBlocks.push(`<blockquote>${markdownToHtml(inner)}</blockquote>`);
      continue;
    }

    // Task list
    if (/^- \[[ x]\]/m.test(trimmed)) {
      const items = trimmed.split("\n").filter((l) => l.trim());
      let listHtml = '<ul data-type="taskList">';
      for (const item of items) {
        const taskMatch = item.match(/^- \[([ x])\]\s*(.*)/);
        if (taskMatch) {
          const checked = taskMatch[1] === "x" ? "true" : "false";
          listHtml += `<li data-type="taskItem" data-checked="${checked}"><label><input type="checkbox"${checked === "true" ? " checked" : ""}><span></span></label><div><p>${inlineMarkdown(taskMatch[2])}</p></div></li>`;
        }
      }
      listHtml += "</ul>";
      processedBlocks.push(listHtml);
      continue;
    }

    // Unordered list
    if (/^[-*+]\s/.test(trimmed)) {
      const items = trimmed.split("\n").filter((l) => l.trim());
      let listHtml = "<ul>";
      for (const item of items) {
        const liMatch = item.match(/^[-*+]\s+(.*)/);
        if (liMatch) listHtml += `<li><p>${inlineMarkdown(liMatch[1])}</p></li>`;
      }
      listHtml += "</ul>";
      processedBlocks.push(listHtml);
      continue;
    }

    // Ordered list
    if (/^\d+\.\s/.test(trimmed)) {
      const items = trimmed.split("\n").filter((l) => l.trim());
      let listHtml = "<ol>";
      for (const item of items) {
        const liMatch = item.match(/^\d+\.\s+(.*)/);
        if (liMatch) listHtml += `<li><p>${inlineMarkdown(liMatch[1])}</p></li>`;
      }
      listHtml += "</ol>";
      processedBlocks.push(listHtml);
      continue;
    }

    // Regular paragraph — handle single newlines as hard breaks
    const lines = trimmed.split("\n");
    const paraContent = lines.map((l) => inlineMarkdown(l)).join("<br>");
    processedBlocks.push(`<p>${paraContent}</p>`);
  }

  let result = processedBlocks.join("");

  // Restore inline codes
  for (let i = 0; i < inlineCodes.length; i++) {
    result = result.replace(`%%INLINECODE_${i}%%`, inlineCodes[i]);
  }

  return result;
}

// ─── Inline Markdown → HTML ──────────────────────────────────────────

function inlineMarkdown(text: string): string {
  let r = text;

  // Images (before links)
  r = r.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img src="$2" alt="$1">');

  // Obsidian image embeds
  r = r.replace(/!\[\[([^\]]+)\]\]/g, '<img src="$1" alt="$1">');

  // Links
  r = r.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');

  // Bold + italic
  r = r.replace(/\*\*\*(.+?)\*\*\*/g, "<strong><em>$1</em></strong>");
  r = r.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  r = r.replace(/\*(.+?)\*/g, "<em>$1</em>");
  r = r.replace(/~~(.+?)~~/g, "<del>$1</del>");
  r = r.replace(/==(.+?)==/g, "<mark>$1</mark>");

  // Hard line breaks (two trailing spaces)
  r = r.replace(/ {2,}\n/g, "<br>");

  return r;
}

// ─── Helpers ─────────────────────────────────────────────────────────

function inlineHtml(html: string): string {
  // Strip block wrappers that might be nested inside inline contexts
  return html.replace(/<\/?(?:p|div)>/gi, "").trim();
}

function stripTags(html: string, ...tags: string[]): string {
  let result = html;
  for (const tag of tags) {
    result = result.replace(new RegExp(`</?${tag}[^>]*>`, "gi"), "");
  }
  return result;
}

function decodeEntities(text: string): string {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ");
}

function encodeEntities(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// ─── Wikilinks ───────────────────────────────────────────────────────

/**
 * Convert Menerio internal note links (HTML anchors with special data
 * attributes or known URL patterns) to Obsidian [[wikilinks]].
 */
export function internalLinksToWikilinks(
  md: string,
  noteIdToTitle: Map<string, string>
): string {
  // Match markdown links pointing to /dashboard/notes/<uuid>
  return md.replace(
    /\[([^\]]+)\]\(\/dashboard\/notes\/([0-9a-f-]+)\)/gi,
    (_, linkText, noteId) => {
      const title = noteIdToTitle.get(noteId);
      return `[[${title || linkText}]]`;
    }
  );
}

/**
 * Convert Obsidian [[wikilinks]] to Menerio internal note links.
 */
export function wikilinksToInternalLinks(
  md: string,
  titleToNoteId: Map<string, string>
): string {
  return md.replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_, target, display) => {
    const label = display || target;
    const noteId = titleToNoteId.get(target) || titleToNoteId.get(target.trim());
    if (noteId) {
      return `[${label}](/dashboard/notes/${noteId})`;
    }
    // Unresolved wikilink — keep as plain text
    return label;
  });
}

// ─── Frontmatter ─────────────────────────────────────────────────────

/**
 * Convert a Menerio note to Obsidian-compatible Markdown with YAML frontmatter.
 */
export function noteToMarkdown(
  note: NoteForExport,
  noteIdToTitle?: Map<string, string>
): string {
  const meta = (note.metadata || {}) as Record<string, unknown>;

  const frontmatter: Record<string, unknown> = {
    id: note.id,
    title: note.title,
    created: note.created_at,
    modified: note.updated_at,
  };

  // Tags: combine note.tags with metadata topics
  const topics = Array.isArray(meta.topics) ? (meta.topics as string[]) : [];
  const allTags = [...new Set([...note.tags, ...topics])];
  if (allTags.length > 0) frontmatter.tags = allTags;

  // Type
  if (meta.type || note.entity_type) {
    frontmatter.type = meta.type || note.entity_type;
  }

  // People
  if (Array.isArray(meta.people) && (meta.people as string[]).length > 0) {
    frontmatter.people = meta.people;
  }

  // Obsidian-compatible properties
  if (Array.isArray(meta.aliases) && (meta.aliases as string[]).length > 0) {
    frontmatter.aliases = meta.aliases;
  }
  if (meta.cssclass) frontmatter.cssclass = meta.cssclass;

  // Re-emit preserved unknown Obsidian frontmatter fields
  if (meta._obsidian_frontmatter && typeof meta._obsidian_frontmatter === "object") {
    Object.assign(frontmatter, meta._obsidian_frontmatter as Record<string, unknown>);
  }

  // Preserve full Menerio metadata as base64 JSON for lossless round-trip
  if (Object.keys(meta).length > 0) {
    frontmatter.menerio_metadata = btoa(JSON.stringify(meta));
  }

  if (note.is_favorite) frontmatter.favorite = true;
  if (note.is_pinned) frontmatter.pinned = true;

  // Build markdown body
  let body = htmlToMarkdown(note.content);

  // Convert internal links to wikilinks
  if (noteIdToTitle) {
    body = internalLinksToWikilinks(body, noteIdToTitle);
  }

  return matter.stringify(body, frontmatter);
}

/**
 * Parse an Obsidian Markdown file into a Menerio note object.
 */
export function markdownToNote(
  markdownString: string,
  titleToNoteId?: Map<string, string>
): ParsedMarkdownNote {
  const { data: fm, content: body } = matter(markdownString);

  // Resolve metadata
  let metadata: Record<string, unknown> = {};

  if (fm.menerio_metadata && typeof fm.menerio_metadata === "string") {
    try {
      metadata = JSON.parse(atob(fm.menerio_metadata));
    } catch {
      // corrupted base64 — fall back to frontmatter fields
    }
  }

  // If no menerio_metadata, build metadata from standard Obsidian frontmatter
  if (Object.keys(metadata).length === 0) {
    if (fm.tags) metadata.topics = Array.isArray(fm.tags) ? fm.tags : [fm.tags];
    if (fm.type) metadata.type = fm.type;
    if (fm.people) metadata.people = Array.isArray(fm.people) ? fm.people : [fm.people];
  }

  // Preserve Obsidian-specific properties
  if (fm.aliases) metadata.aliases = Array.isArray(fm.aliases) ? fm.aliases : [fm.aliases];
  if (fm.cssclass) metadata.cssclass = fm.cssclass;

  // Preserve unknown frontmatter fields for lossless round-trip
  const knownKeys = new Set([
    "id", "title", "created", "modified", "tags", "type", "people",
    "menerio_metadata", "favorite", "pinned", "aliases", "cssclass",
  ]);
  const unknownFields: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(fm)) {
    if (!knownKeys.has(key)) unknownFields[key] = val;
  }
  if (Object.keys(unknownFields).length > 0) {
    metadata._obsidian_frontmatter = unknownFields;
  }

  // Detect daily notes pattern (YYYY-MM-DD.md title)
  const title = fm.title || "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(title)) {
    metadata.type = metadata.type || "daily_note";
  }

  // Convert wikilinks to internal links
  let processedBody = body;
  if (titleToNoteId) {
    processedBody = wikilinksToInternalLinks(processedBody, titleToNoteId);
  }

  // Convert markdown body to HTML for Tiptap
  const htmlContent = markdownToHtml(processedBody);

  // Tags
  const tags: string[] = [];
  if (Array.isArray(fm.tags)) tags.push(...fm.tags);
  else if (typeof fm.tags === "string") tags.push(fm.tags);

  return {
    id: fm.id || undefined,
    title: fm.title || "",
    content: htmlContent,
    metadata,
    tags: [...new Set(tags)],
    created_at: fm.created || undefined,
    updated_at: fm.modified || undefined,
    entity_type: fm.type || null,
  };
}

// ─── File path utilities ─────────────────────────────────────────────

/**
 * Determine the file path for a note in the GitHub repo.
 */
export function noteToFilePath(note: NoteForExport, vaultPath = "/"): string {
  const meta = (note.metadata || {}) as Record<string, unknown>;

  // Sanitise title for filesystem
  let fileName = sanitizeFileName(note.title || "Untitled");

  // Determine subdirectory
  let subDir = "";
  if (meta.is_quick_capture) {
    subDir = "Inbox";
  }

  // Build full path
  const base = vaultPath === "/" ? "" : vaultPath.replace(/^\/|\/$/g, "");
  const parts = [base, subDir, `${fileName}.md`].filter(Boolean);
  return parts.join("/");
}

/**
 * Extract a note title from a file path.
 */
export function filePathToNoteTitle(filePath: string): string {
  const baseName = filePath.split("/").pop() || filePath;
  return baseName.replace(/\.md$/i, "");
}

/**
 * Sanitise a string for use as a filename.
 */
function sanitizeFileName(name: string): string {
  return name
    .replace(/[<>:"/\\|?*]/g, "")  // Remove illegal filesystem chars
    .replace(/\s+/g, " ")           // Collapse whitespace
    .trim()
    .slice(0, 200);                  // Limit length
}
