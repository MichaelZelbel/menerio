import matter from "gray-matter";
import { coalesceTaskList as coalesceTaskListMd, looksLikeHtml } from "@/lib/note-content";

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

type TiptapMark = { type: string; attrs?: Record<string, unknown> | null };
type TiptapNode = {
  type: string;
  text?: string;
  attrs?: Record<string, unknown> | null;
  marks?: TiptapMark[];
  content?: TiptapNode[];
};

function encodeBase64Utf8(value: string): string {
  return btoa(unescape(encodeURIComponent(value)));
}

function decodeBase64Utf8(value: string): string {
  return decodeURIComponent(escape(atob(value)));
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

  // Images — preserve Obsidian wikilink embeds when an attachment marker is present
  md = md.replace(/<img[^>]*data-attachment-name="([^"]+)"[^>]*\/?>/gi, (_, name) => `![[${decodeEntities(name)}]]`);
  md = md.replace(/<a[^>]*data-attachment-name="([^"]+)"[^>]*>[\s\S]*?<\/a>/gi, (_, name) => `![[${decodeEntities(name)}]]`);
  // PDF iframes — Obsidian embed when attachment marker is present, otherwise ![pdf](url)
  md = md.replace(/<iframe[^>]*data-type="pdf"[^>]*data-attachment-name="([^"]+)"[^>]*>(?:[\s\S]*?<\/iframe>)?/gi, (_, name) => `![[${decodeEntities(name)}]]`);
  md = md.replace(/<iframe[^>]*data-attachment-name="([^"]+)"[^>]*data-type="pdf"[^>]*>(?:[\s\S]*?<\/iframe>)?/gi, (_, name) => `![[${decodeEntities(name)}]]`);
  md = md.replace(/<iframe[^>]*data-type="pdf"[^>]*src="([^"]*)"[^>]*>(?:[\s\S]*?<\/iframe>)?/gi, (_, src) => `![pdf](${src})`);
  md = md.replace(/<img[^>]*src="([^"]*)"[^>]*alt="([^"]*)"[^>]*\/?>/gi, (_, src, alt) => `![${alt}](${src})`);
  md = md.replace(/<img[^>]*src="([^"]*)"[^>]*\/?>/gi, (_, src) => `![](${src})`);

  // Links
  md = md.replace(/<span[^>]*data-wikilink="true"[^>]*data-note-title="([^"]*)"[^>]*data-display-text="([^"]*)"[^>]*>[\s\S]*?<\/span>/gi, (_, title, display) => {
    const label = decodeEntities(display || title);
    const target = decodeEntities(title);
    return label && label !== target ? `[[${target}|${label}]]` : `[[${target}]]`;
  });
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

  // Empty paragraphs → preserve as a blank line (Obsidian behaviour).
  // Each empty <p></p> contributes one extra `\n` (one blank source line)
  // on top of the `\n\n` produced by surrounding paragraphs.
  md = md.replace(/<p[^>]*>(?:\s|&nbsp;|<br\s*\/?>(?:\s|&nbsp;)*)*<\/p>/gi, "\n");

  // Paragraphs → double newlines
  md = md.replace(/<p[^>]*>([\s\S]*?)<\/p>/gi, (_, c) => `${inlineHtml(c)}\n\n`);

  // Strip remaining tags
  md = md.replace(/<[^>]+>/g, "");

  // Decode entities
  md = decodeEntities(md);

  // Trim trailing whitespace but preserve internal blank lines.
  return md.replace(/[ \t]+\n/g, "\n").replace(/\s+$/, "") + "\n";
}

/**
 * Serialize the live TipTap document to Markdown without going through HTML.
 * This keeps editor-only nodes such as wikilinks intact and avoids the
 * tiptap-markdown hard-break escaping loop seen during autosave.
 */
export function tiptapJsonToMarkdown(doc: TiptapNode | null | undefined): string {
  if (!doc) return "";
  // Preserve user-authored blank lines (Obsidian behaviour); only trim trailing whitespace.
  return serializeBlock(doc, 0).replace(/[ \t]+\n/g, "\n").replace(/\s+$/, "");
}

// Placeholders for extracted code. NUL never occurs in note text, so a note that
// literally contains a placeholder-looking string (older saves wrote
// `%%CODEBLOCK\_0%%` into notes) can never be mistaken for one.
const NUL = String.fromCharCode(0);
const CODE_BLOCK_TOKEN = new RegExp(`${NUL}CODEBLOCK(\\d+)${NUL}`, "g");
const WHOLE_CODE_BLOCK_TOKEN = new RegExp(`^${NUL}CODEBLOCK(\\d+)${NUL}$`);
const INLINE_CODE_TOKEN = new RegExp(`${NUL}INLINECODE(\\d+)${NUL}`, "g");
const codeBlockToken = (i: number) => `${NUL}CODEBLOCK${i}${NUL}`;
// An escape pair (left as is), or a code span: a full backtick run, content, and
// a closing run of the same length.
const INLINE_CODE_SPAN = /\\[\\`]|(?<!`)(`+)(?!`)([\s\S]*?[^`])\1(?!`)/g;
const inlineCodeToken = (i: number) => `${NUL}INLINECODE${i}${NUL}`;

interface RenderContext {
  codeBlocks: string[];
  inlineCodes: string[];
}

/**
 * Convert Markdown back to Tiptap-compatible HTML.
 */
export function markdownToHtml(md: string): string {
  if (!md) return "";
  const ctx: RenderContext = { codeBlocks: [], inlineCodes: [] };

  // Fenced code first, so nothing below (task-list coalescing, the hard-break
  // marker removal, inline parsing) ever rewrites code, e.g. a shell line
  // continuation `\` at the end of a line.
  let html = extractFencedCode(md.replace(/\r\n?/g, "\n"), ctx.codeBlocks);

  html = coalesceTaskListMd(html);
  // Tiptap's Markdown serializer represents hard breaks as a trailing
  // backslash before the newline. Our block parser already renders single
  // newlines as hard breaks, so drop the marker instead of re-feeding the
  // literal backslash into the editor on every save cycle.
  html = html.replace(/\\\n/g, "\n");

  // Inline code (protect from further processing). Escaped backticks are
  // skipped, so "\`a\`" typed as text is not read back as a code span, and a
  // span may use a longer backtick run to hold a backtick (`` a`b ``).
  html = html.replace(INLINE_CODE_SPAN, (match, _ticks: string | undefined, code: string | undefined) => {
    if (code === undefined) return match;
    const content = /^ [\s\S]* $/.test(code) && code.trim() ? code.slice(1, -1) : code;
    ctx.inlineCodes.push(`<code>${encodeEntities(content)}</code>`);
    return inlineCodeToken(ctx.inlineCodes.length - 1);
  });

  let result = renderBlocks(html, ctx);

  // A code block that did not end up as a block of its own (it should always
  // do so, see extractFencedCode) is still restored rather than dropped.
  // Replacer functions, never strings: String.replace reads `$$`, `$&`,
  // `` $` `` and `$'` in a replacement string as patterns, so `echo $$` in
  // code came back as `echo $` and `$'` spliced in the rest of the document,
  // and the next autosave made it permanent.
  result = result.replace(CODE_BLOCK_TOKEN, (_m, i) => ctx.codeBlocks[Number(i)] ?? "");
  result = result.replace(INLINE_CODE_TOKEN, (_m, i) => ctx.inlineCodes[Number(i)] ?? "");

  return result;
}

/**
 * Replace every fenced code block with a placeholder that stands as a block of
 * its own (blank lines around it), so a fence written directly under a line
 * of text, inside a list item or inside a blockquote is still a code block and
 * its code is never re-saved as the placeholder text. Fences may be indented
 * (list items) or quoted (`> ```js`); the indentation and the quote markers are
 * taken off every code line. The closing fence must be at least as long as the
 * opening one (CommonMark), so code that itself contains ``` lines survives
 * when a longer fence is used (the serializer picks one).
 */
function extractFencedCode(md: string, codeBlocks: string[]): string {
  if (!md.includes("```")) return md;
  const lines = md.split("\n");
  const out: string[] = [];
  const QUOTE_PREFIX = /^(?:[ \t]{0,3}>[ \t]?)/;

  for (let i = 0; i < lines.length; i++) {
    // Group 2 is the indentation, including a list marker when the fence opens
    // on the bullet line itself (`- ```bash`); that bullet holds nothing else.
    const open = lines[i].match(/^((?:[ \t]{0,3}>[ \t]?)*)([ \t]*(?:(?:[-*+]|\d+[.)])[ \t]+)?)(`{3,})(.*)$/);
    // A fence's info string cannot contain a backtick, which also keeps
    // one-line ```code``` from being read as an opening fence.
    if (!open || open[4].includes("`")) {
      out.push(lines[i]);
      continue;
    }
    const [, quote, indent, fence, info] = open;
    const quoteDepth = (quote.match(/>/g) || []).length;
    const closing = new RegExp(`^[ \\t]*\`{${fence.length},}[ \\t]*$`);

    const body: string[] = [];
    let closeAt = -1;
    for (let j = i + 1; j < lines.length; j++) {
      let line = lines[j];
      let stripped = true;
      for (let d = 0; d < quoteDepth && stripped; d++) {
        const m = line.match(QUOTE_PREFIX);
        if (m) line = line.slice(m[0].length);
        else stripped = false;
      }
      if (!stripped) break; // the quote ended before the fence was closed
      if (closing.test(line)) {
        closeAt = j;
        break;
      }
      body.push(stripIndent(line, indent.length));
    }
    if (closeAt < 0) {
      out.push(lines[i]); // unclosed: leave it as ordinary text
      continue;
    }

    const language = info.trim().split(/\s+/)[0] || "";
    const langAttr = language ? ` class="language-${encodeAttribute(language)}"` : "";
    // Newlines as &#10;: tiptap-markdown re-reads the editor's HTML with
    // markdown-it, and a blank line inside the code ended its HTML block and
    // turned the rest of the code into Markdown paragraphs.
    const code = encodeEntities(body.join("\n")).replace(/\n/g, "&#10;");
    codeBlocks.push(`<pre><code${langAttr}>${code}</code></pre>`);
    const token = codeBlockToken(codeBlocks.length - 1);

    const prefix = quoteDepth ? `${">".repeat(quoteDepth)} ` : "";
    const separator = quoteDepth ? ">".repeat(quoteDepth) : "";
    const isBlank = (line: string | undefined) =>
      line === undefined || (quoteDepth ? /^[\s>]*$/.test(line) : line.trim() === "");
    if (out.length && !isBlank(out[out.length - 1])) out.push(separator);
    out.push(`${prefix}${token}`);
    if (closeAt + 1 < lines.length && !isBlank(lines[closeAt + 1])) out.push(separator);
    i = closeAt;
  }
  return out.join("\n");
}

function stripIndent(line: string, width: number): string {
  let n = 0;
  while (n < width && n < line.length && (line[n] === " " || line[n] === "\t")) n++;
  return line.slice(n);
}

function renderBlocks(md: string, ctx: RenderContext): string {
  // Split into blocks by double newlines, but capture separator runs so we
  // can preserve user-authored blank lines (Obsidian behaviour).
  const segments = md.split(/(\n{2,})/);
  const processedBlocks: string[] = [];

  for (let segIdx = 0; segIdx < segments.length; segIdx++) {
    const segment = segments[segIdx];
    // Odd indices are separator runs (\n\n, \n\n\n, …). For each newline beyond
    // the first 2, insert one empty paragraph to render a blank line.
    if (segIdx % 2 === 1) {
      const extra = Math.max(0, segment.length - 2);
      for (let i = 0; i < extra; i++) processedBlocks.push("<p></p>");
      continue;
    }
    const trimmed = segment.trim();
    if (!trimmed) continue;
    processedBlocks.push(renderBlock(trimmed, ctx));
  }

  return processedBlocks.join("");
}

function renderBlock(trimmed: string, ctx: RenderContext): string {
  // Code block placeholder
  const codeMatch = trimmed.match(WHOLE_CODE_BLOCK_TOKEN);
  if (codeMatch) return ctx.codeBlocks[Number(codeMatch[1])] ?? "";

  // Horizontal rule
  if (/^(-{3,}|_{3,}|\*{3,})$/.test(trimmed)) return "<hr>";

  // Headings
  const headingMatch = trimmed.match(/^(#{1,6})\s+(.+)$/);
  if (headingMatch) {
    const level = headingMatch[1].length;
    return `<h${level}>${inlineMarkdown(headingMatch[2])}</h${level}>`;
  }

  // GFM table: a header line followed by a delimiter row. Lines above it (a
  // caption, a heading) and non-table lines below it are rendered on their own
  // instead of being swallowed into the table.
  const lines = trimmed.split("\n");
  const table = findTable(lines);
  if (table) {
    const before = lines.slice(0, table.start).join("\n").trim();
    const after = lines.slice(table.end).join("\n").trim();
    return (
      (before ? renderBlock(before, ctx) : "") +
      renderTable(lines.slice(table.start, table.end), ctx) +
      (after ? renderBlock(after, ctx) : "")
    );
  }

  // Blockquote. Shares the code placeholders with the outer document, so a
  // fenced block inside a quote is restored instead of lost.
  if (trimmed.startsWith(">")) {
    const inner = lines.map((l) => l.replace(/^>\s?/, "")).join("\n");
    return `<blockquote>${renderBlocks(inner, ctx)}</blockquote>`;
  }

  // Lists, including indented/nested items. The previous flat-list parser
  // silently dropped lines such as `  - [link](url)`, which made nested links
  // disappear from notes even though the Markdown was still stored correctly.
  if (isListBlock(trimmed)) return markdownListToHtml(trimmed);

  // Regular paragraph — handle single newlines as hard breaks
  return `<p>${lines.map((l) => inlineMarkdown(l)).join("<br>")}</p>`;
}

// ─── GFM tables ──────────────────────────────────────────────────────

type ColumnAlign = "left" | "center" | "right" | null;

/** Splits on unescaped pipes, trimming the optional outer pipes; `\|` becomes `|`. */
function splitTableRow(line: string): string[] {
  let s = line.trim();
  if (s.startsWith("|")) s = s.slice(1);
  const cells: string[] = [];
  let cur = "";
  let endedOnPipe = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    endedOnPipe = false;
    if (ch === "\\" && i + 1 < s.length) {
      cur += s[i + 1] === "|" ? "|" : ch + s[i + 1];
      i++;
      continue;
    }
    if (ch === "|") {
      cells.push(cur.trim());
      cur = "";
      endedOnPipe = true;
      continue;
    }
    cur += ch;
  }
  if (!endedOnPipe) cells.push(cur.trim());
  return cells;
}

function hasUnescapedPipe(line: string): boolean {
  return /(^|[^\\])(\\\\)*\|/.test(line);
}

const TABLE_DELIMITER_CELL = /^:?-+:?$/;

function findTable(lines: string[]): { start: number; end: number } | null {
  for (let k = 0; k + 1 < lines.length; k++) {
    if (!hasUnescapedPipe(lines[k]) || !hasUnescapedPipe(lines[k + 1])) continue;
    const delimiter = splitTableRow(lines[k + 1]);
    if (!delimiter.length || !delimiter.every((c) => TABLE_DELIMITER_CELL.test(c))) continue;
    if (splitTableRow(lines[k]).length !== delimiter.length) continue;
    let end = k + 2;
    while (end < lines.length && hasUnescapedPipe(lines[end])) end++;
    return { start: k, end };
  }
  return null;
}

function renderTable(rows: string[], ctx: RenderContext): string {
  const aligns: ColumnAlign[] = splitTableRow(rows[1]).map((c) => {
    const left = c.startsWith(":");
    const right = c.endsWith(":");
    if (left && right) return "center";
    if (right) return "right";
    if (left) return "left";
    return null;
  });
  const renderRow = (row: string, tag: "th" | "td") => {
    const cells = splitTableRow(row);
    while (cells.length < aligns.length) cells.push("");
    return (
      "<tr>" +
      cells
        .map((cell, i) => {
          // GFM reads `\|` before inline parsing, inline code included.
          const content = inlineMarkdown(
            cell.replace(INLINE_CODE_TOKEN, (m, idx) => {
              const n = Number(idx);
              if (ctx.inlineCodes[n]) ctx.inlineCodes[n] = ctx.inlineCodes[n].replace(/\\\|/g, "|");
              return m;
            }),
          );
          const align = aligns[i];
          return align
            ? `<${tag}><p style="text-align: ${align}">${content}</p></${tag}>`
            : `<${tag}>${content}</${tag}>`;
        })
        .join("") +
      "</tr>"
    );
  };
  const body = rows.slice(2).map((row) => renderRow(row, "td")).join("");
  return `<table><thead>${renderRow(rows[0], "th")}</thead><tbody>${body}</tbody></table>`;
}

const LIST_LINE_PATTERN = /^(\s*)(?:(- \[([ xX])\](?:\s+|$))|([-*+])(?:\s+|$)|(\d+)\.(?:\s+|$))(.*)$/;

function isListBlock(block: string): boolean {
  return /^\s*(?:[-*+](?:\s+|$)|\d+\.(?:\s+|$)|- \[[ xX]\](?:\s+|$))/m.test(block);
}

type ListLine = {
  indent: number;
  ordered: boolean;
  /** The written number of an ordered item (`3.` -> 3). */
  number: number;
  task: boolean;
  checked: boolean;
  content: string;
};

function parseListLine(line: string): ListLine | null {
  const match = line.match(LIST_LINE_PATTERN);
  if (!match) return null;
  return {
    indent: match[1].replace(/\t/g, "  ").length,
    ordered: Boolean(match[5]),
    number: match[5] ? parseInt(match[5], 10) : 1,
    task: Boolean(match[2]),
    checked: String(match[3] || "").toLowerCase() === "x",
    content: match[6] || "",
  };
}

/**
 * Renders one contiguous run of list lines. Sibling lists (a type change such as
 * bullets → checkboxes) are emitted one after another instead of dropping the
 * remaining lines, which previously deleted content on the next autosave.
 */
function renderListLines(lines: ListLine[]): string {
  const render = (start: number, indent: number): { html: string; next: number } => {
    const listType = lines[start]?.ordered ? "ol" : "ul";
    const isTaskList = Boolean(lines[start]?.task) && listType === "ul";
    // Keep the first number of an ordered list: "3. third" used to come back as "1. third".
    const startAttr = listType === "ol" && lines[start].number !== 1 ? ` start="${lines[start].number}"` : "";
    let html = isTaskList ? '<ul data-type="taskList">' : `<${listType}${startAttr}>`;
    let index = start;

    while (index < lines.length) {
      const item = lines[index];
      if (item.indent < indent) break;
      if (item.indent > indent) {
        const nested = render(index, item.indent);
        html += nested.html;
        index = nested.next;
        continue;
      }
      if (item.ordered !== (listType === "ol") || item.task !== isTaskList) break;

      index++;
      let nestedHtml = "";
      while (index < lines.length && lines[index].indent > indent) {
        const nested = render(index, lines[index].indent);
        nestedHtml += nested.html;
        index = nested.next;
      }

      if (isTaskList) {
        const checked = item.checked ? "true" : "false";
        html += `<li data-type="taskItem" data-checked="${checked}"><label><input type="checkbox"${item.checked ? " checked" : ""}><span></span></label><div><p>${inlineMarkdown(item.content)}</p>${nestedHtml}</div></li>`;
      } else {
        html += `<li><p>${inlineMarkdown(item.content)}</p>${nestedHtml}</li>`;
      }
    }

    html += isTaskList ? "</ul>" : `</${listType}>`;
    return { html, next: index };
  };

  let html = "";
  let cursor = 0;
  while (cursor < lines.length) {
    const { html: part, next } = render(cursor, lines[cursor].indent);
    html += part;
    cursor = next > cursor ? next : cursor + 1;
  }
  return html;
}

function markdownListToHtml(block: string): string {
  const rawLines = block.split("\n");
  let html = "";
  let pendingList: ListLine[] = [];
  let pendingText: string[] = [];

  const flushText = () => {
    if (!pendingText.length) return;
    html += `<p>${pendingText.map((l) => inlineMarkdown(l)).join("<br>")}</p>`;
    pendingText = [];
  };
  const flushList = () => {
    if (!pendingList.length) return;
    html += renderListLines(pendingList);
    pendingList = [];
  };

  for (const line of rawLines) {
    const parsed = parseListLine(line);
    if (parsed) {
      flushText();
      pendingList.push(parsed);
      continue;
    }
    if (line.trim().length === 0) continue;
    // Indented continuation of the previous item — keep it inside that item.
    if (pendingList.length > 0 && /^\s+/.test(line)) {
      const prev = pendingList[pendingList.length - 1];
      prev.content = `${prev.content}<br>${line.trim()}`;
      continue;
    }
    // Non-indented prose (e.g. a `--` divider) — its own paragraph, never swallowed.
    flushList();
    pendingText.push(line.trim());
  }

  flushList();
  flushText();
  return html;
}


function serializeBlock(node: TiptapNode, depth: number): string {
  const children = () => serializeInlineChildren(node);
  switch (node.type) {
    case "doc": {
      const kids = node.content || [];
      const parts: string[] = [];
      let pendingBlanks = 0;
      for (const child of kids) {
        const isEmptyParagraph =
          child.type === "paragraph" && !(child.content && child.content.length);
        if (isEmptyParagraph) {
          pendingBlanks++;
          continue;
        }
        const text = serializeBlock(child, depth);
        if (parts.length === 0) {
          parts.push(text);
        } else {
          parts.push("\n".repeat(pendingBlanks) + text);
        }
        pendingBlanks = 0;
      }
      return parts.join("\n\n") + (pendingBlanks > 0 ? "\n".repeat(pendingBlanks) : "");
    }
    case "paragraph":
      return children();
    case "heading": {
      const level = Math.min(Math.max(Number(node.attrs?.level) || 1, 1), 6);
      return `${"#".repeat(level)} ${children()}`.trimEnd();
    }
    case "bulletList":
      return serializeList(node, depth, false);
    case "orderedList":
      return serializeList(node, depth, true);
    case "listItem":
      return serializeListItem(node, depth);
    case "taskList":
      return (node.content || []).map((item) => serializeTaskItem(item, depth)).join("\n");
    case "blockquote":
      return (node.content || []).map((child) => serializeBlock(child, depth)).join("\n\n").split("\n").map((line) => `> ${line}`).join("\n");
    case "codeBlock": {
      const code = serializeText(node);
      // A fence longer than any backtick run in the code, so code that itself
      // contains ``` (a Markdown example) does not close the block early.
      const longestRun = Math.max(0, ...(code.match(/`+/g) || []).map((run) => run.length));
      const fence = "`".repeat(Math.max(3, longestRun + 1));
      return `${fence}${node.attrs?.language || ""}\n${code}\n${fence}`;
    }
    case "horizontalRule":
      return "---";
    case "table":
      return serializeTable(node);
    case "image": {
      const attachName = String(node.attrs?.["data-attachment-name"] || node.attrs?.dataAttachmentName || "");
      if (attachName) return `![[${attachName}]]`;
      return `![${node.attrs?.alt || ""}](${formatDestination(String(node.attrs?.src || ""))})`;
    }
    case "videoEmbed":
      return `![video](${formatDestination(String(node.attrs?.src || ""))})`;
    case "pdfEmbed": {
      const attachName = String(node.attrs?.["data-attachment-name"] || node.attrs?.dataAttachmentName || "");
      if (attachName) return `![[${attachName}]]`;
      return `![pdf](${formatDestination(String(node.attrs?.src || ""))})`;
    }
    case "audioEmbed":
      return `![audio](${formatDestination(String(node.attrs?.src || ""))})`;
    default:
      return node.text ? serializeInlineNode(node) : (node.content || []).map((child) => serializeBlock(child, depth)).join("\n\n");
  }
}

function serializeInlineChildren(node: TiptapNode): string {
  return (node.content || []).map(serializeInlineNode).join("");
}

function serializeInlineNode(node: TiptapNode): string {
  if (node.type === "text") {
    const marks = node.marks || [];
    const raw = node.text || "";
    // Code keeps its text verbatim: the loader reads code spans without
    // unescaping, so escaping here added backslashes on every save.
    const text = marks.some((mark) => mark.type === "code") ? raw : escapeMarkdownText(raw);
    return applyMarks(text, marks);
  }
  if (node.type === "hardBreak") return "  \n";
  if (node.type === "wikilink") {
    const title = String(node.attrs?.noteTitle || "");
    const display = String(node.attrs?.displayText || "");
    return display && display !== title ? `[[${title}|${display}]]` : `[[${title}]]`;
  }
  if (node.type === "image") {
    const attachName = String(node.attrs?.["data-attachment-name"] || node.attrs?.dataAttachmentName || "");
    if (attachName) return `![[${attachName}]]`;
    return `![${node.attrs?.alt || ""}](${formatDestination(String(node.attrs?.src || ""))})`;
  }
  return serializeInlineChildren(node);
}

function serializeList(node: TiptapNode, depth: number, ordered: boolean): string {
  const start = Number(node.attrs?.start);
  let index = node.attrs?.start != null && Number.isInteger(start) && start >= 0 ? start : 1;
  return (node.content || []).map((item) => {
    const marker = ordered ? `${index++}.` : "-";
    return `${"  ".repeat(depth)}${marker} ${serializeListItem(item, depth + 1)}`;
  }).join("\n");
}

const LIST_NODE_TYPES = new Set(["bulletList", "orderedList", "taskList"]);

function serializeListItem(node: TiptapNode, depth: number): string {
  const parts = node.content || [];
  if (!parts.length) return "";
  // Continuation lines (a Shift+Enter line break, a second paragraph) are
  // indented under the item: at column 0 they ended the list on reload.
  // Nested lists indent themselves.
  const pad = "  ".repeat(depth);
  const indent = (text: string, fromFirstLine: boolean) =>
    text.split("\n").map((line, i) => (line && (fromFirstLine || i > 0) ? pad + line : line)).join("\n");
  const first = parts[0].type === "paragraph"
    ? indent(serializeInlineChildren(parts[0]), false)
    : serializeBlock(parts[0], depth);
  const rest = parts.slice(1).map((child) => {
    const text = serializeBlock(child, depth);
    return LIST_NODE_TYPES.has(child.type) ? text : indent(text, true);
  }).filter(Boolean);
  return [first, ...rest].filter(Boolean).join("\n");
}

function serializeTaskItem(node: TiptapNode, depth: number): string {
  const checked = node.attrs?.checked === true ? "x" : " ";
  const body = serializeListItem(node, depth + 1);
  // Empty items must not keep a trailing space: `- [ ] ` gets trimmed by other
  // pipelines and would come back as a literal "[ ]" bullet.
  return `${"  ".repeat(depth)}- [${checked}]${body ? ` ${body}` : ""}`;
}

function serializeText(node: TiptapNode): string {
  if (node.text) return node.text;
  return (node.content || []).map(serializeText).join("");
}

function serializeTable(node: TiptapNode): string {
  const rows = (node.content || []).map((row) => (row.content || []).map(serializeTableCell));
  if (!rows.length) return "";
  const colCount = Math.max(...rows.map((row) => row.length));
  const pad = (row: string[]) => [...row, ...Array(Math.max(0, colCount - row.length)).fill("")];
  const header = pad(rows[0]);
  // Column alignment lives on the header cells' paragraphs (the loader puts it
  // there from a `:---:` delimiter row).
  const headerCells = node.content?.[0]?.content || [];
  const separator = Array.from({ length: colCount }, (_, i) => {
    const align = headerCells[i]?.content?.[0]?.attrs?.textAlign;
    if (align === "center") return ":---:";
    if (align === "right") return "---:";
    if (align === "left") return ":---";
    return "---";
  });
  const body = rows.slice(1).map((row) => `| ${pad(row).join(" | ")} |`);
  return [`| ${header.join(" | ")} |`, `| ${separator.join(" | ")} |`, ...body].join("\n");
}

/**
 * A GFM cell is one line: line breaks and further paragraphs become `<br>`
 * (which the loader reads back), and a literal pipe is escaped so it cannot
 * split the cell.
 */
function serializeTableCell(cell: TiptapNode): string {
  return (cell.content || [])
    .map((child) => (child.type === "paragraph" ? serializeInlineChildren(child) : serializeBlock(child, 0)))
    .filter(Boolean)
    .join("<br>")
    .replace(/[ \t]*\n/g, "<br>")
    .replace(/\|/g, "\\|")
    .trim();
}

function applyMarks(text: string, marks: TiptapMark[]): string {
  // Code innermost: `**x**` inside backticks would be literal asterisks.
  const ordered = [...marks].sort((a, b) => Number(b.type === "code") - Number(a.type === "code"));
  return ordered.reduce((value, mark) => {
    switch (mark.type) {
      case "bold": return `**${value}**`;
      case "italic": return `*${value}*`;
      case "strike": return `~~${value}~~`;
      case "code": {
        // Code holding a backtick needs a longer delimiter run (`` a`b ``).
        const longest = Math.max(0, ...(value.match(/`+/g) || []).map((run) => run.length));
        if (!longest) return `\`${value}\``;
        const ticks = "`".repeat(longest + 1);
        return `${ticks} ${value} ${ticks}`;
      }
      // Marks without a Markdown syntax are written as the inline HTML the
      // loader lets through, instead of being dropped on save.
      case "highlight": {
        const color = mark.attrs?.color;
        return color ? `<mark data-color="${encodeAttribute(String(color))}">${value}</mark>` : `==${value}==`;
      }
      case "underline": return `<u>${value}</u>`;
      case "superscript": return `<sup>${value}</sup>`;
      case "subscript": return `<sub>${value}</sub>`;
      case "textStyle": {
        const color = mark.attrs?.color;
        return color ? `<span style="color: ${encodeAttribute(String(color))}">${value}</span>` : value;
      }
      case "wikiLink": return `[[${String(mark.attrs?.slug || value)}]]`;
      case "link": return `[${value}](${formatDestination(String(mark.attrs?.href || ""))})`;
      default: return value;
    }
  }, text);
}

/**
 * The loader reads one level of balanced parentheses in a link destination
 * (https://en.wikipedia.org/wiki/Mercury_(planet)); anything else is
 * percent-encoded so a ")" cannot end the link early.
 */
function formatDestination(url: string): string {
  let depth = 0;
  for (const ch of url) {
    if (ch === "(") depth++;
    else if (ch === ")") depth--;
    if (depth < 0 || depth > 1) break;
  }
  return depth === 0 ? url : url.replace(/\(/g, "%28").replace(/\)/g, "%29");
}

// The block tags that make note-content's looksLikeHtml() treat a whole note as HTML.
const LOOKS_LIKE_HTML_TAG = /^(?:p|h[1-6]|ul|ol|li|blockquote|pre|img|table)\b/i;

// Backslash-escape the inline Markdown metacharacters so literal text round-trips
// (e.g. "2 * 3 * 4" serializes as "2 \* 3 \* 4" and does NOT re-parse as emphasis
// on reload). Backslash is first so the escapes we add aren't doubled.
// The parse side (inlineMarkdown) strips these escapes back out.
function escapeMarkdownText(text: string): string {
  return text
    .replace(/([\\*_`[\]])/g, "\\$1")
    // `&lt;` or `&nbsp;` typed as text must not come back as an entity.
    .replace(/&(?=#?[a-z0-9]+;)/gi, "\\&")
    // `<` before a letter would be read as an HTML tag: "List<String>" and
    // "<anna@example.com>" lost their text on the next load. In front of a
    // block tag name a numeric entity is used instead, because `\<p>` still
    // makes note-content's looksLikeHtml() treat the whole note as HTML.
    .replace(/<(?=[a-z/!?])/gi, (_m, offset: number, s: string) =>
      LOOKS_LIKE_HTML_TAG.test(s.slice(offset + 1)) ? "&#60;" : "\\<",
    )
    // `==` and `~~` that could open or close a highlight or strikethrough
    // ("a==b==c") are escaped. A pair with whitespace on both sides, as in
    // "if x == 1 and y == 2", can do neither and is left as typed.
    .replace(/={2,}|~{2,}/g, (run, offset: number, s: string) => {
      const spaced = run.length === 2 && /\s/.test(s[offset - 1] ?? "") && /\s/.test(s[offset + 2] ?? "");
      return spaced ? run : run.replace(/[=~]/g, "\\$&");
    });
}

// ─── Inline Markdown → HTML ──────────────────────────────────────────

// A link destination: no parentheses except balanced pairs one level deep, so
// https://en.wikipedia.org/wiki/Mercury_(planet) keeps its closing ")".
const DEST = String.raw`((?:[^()\n]|\([^()\n]*\))+)`;
const PDF_EMBED = new RegExp(String.raw`!\[pdf\]\(${DEST}\)`, "gi");
const MEDIA_EMBED = new RegExp(String.raw`!\[(video|audio)\]\(${DEST}\)`, "gi");
const IMAGE = new RegExp(String.raw`!\[([^\]]*)\]\(${DEST}\)`, "g");
const PDF_LINK = new RegExp(String.raw`\[([^\]]+\.pdf)\]\(${DEST}\)`, "gi");
const LINK = new RegExp(String.raw`\[([^\]]+)\]\(${DEST}\)`, "g");
const IMAGE_FILE = /\.(?:png|jpe?g|gif|webp|svg|bmp|avif)(?:[?#]|$)/i;
const VIDEO_IFRAME_HOST = /youtube|youtu\.be|vimeo|dailymotion/i;

// Every `<` that does not open one of these tags is text. They are the inline
// tags the editor can hold and the serializer writes (underline, sup/sub,
// colored text, a colored highlight, <br> in table cells), plus the formatting
// and media tags TipTap reads. Before this, "List<String>" and
// "<anna@example.com>" were parsed as unknown elements and deleted.
const NOT_AN_INLINE_TAG = /<(?!\/?(?:u|sup|sub|mark|span|br|b|strong|i|em|s|del|strike|code|a|img|video|audio)\b[^<>]*>)/gi;

// Backslash escapes the serializer writes (escapeMarkdownText) and that are
// read back as the literal character.
const ESCAPABLE = /\\([\\*_`[\]<&=~])/g;
const ESCAPE_TOKEN = new RegExp(`${NUL}ESC(\\d+)${NUL}`, "g");

const quoteAttribute = (value: string) => value.replace(/"/g, "&quot;");

function inlineMarkdown(text: string): string {
  // Pull backslash-escaped Markdown specials out into placeholders BEFORE any
  // parsing so "2 \* 3" is not italicized; they're restored as literal chars at
  // the end. Mirrors escapeMarkdownText on the serialize side. The NUL token
  // never appears in note text (same technique as wikilink-resolver).
  const escaped: string[] = [];
  const hold = (ch: string) => {
    escaped.push(ch);
    return `${NUL}ESC${escaped.length - 1}${NUL}`;
  };
  let r = text.replace(ESCAPABLE, (_m, ch: string) => hold(ch));
  // A `<` that does not open a supported inline tag is literal text.
  r = r.replace(NOT_AN_INLINE_TAG, () => hold("<"));

  // PDF embed via explicit `![pdf](url)` syntax — render as iframe.
  r = r.replace(PDF_EMBED, (_, src) => {
    return `<iframe data-type="pdf" src="${encodeAttribute(src)}" frameborder="0" title="PDF document"></iframe>`;
  });

  // `![video](url)` and `![audio](url)`, as the serializer writes the embed
  // nodes; they used to come back as broken images. An actual image file with
  // the alt text "video" stays an image.
  r = r.replace(MEDIA_EMBED, (match, kind: string, src: string) => {
    if (IMAGE_FILE.test(src)) return match;
    const safeSrc = encodeAttribute(src);
    if (kind.toLowerCase() === "audio") return `<audio src="${safeSrc}" controls></audio>`;
    return VIDEO_IFRAME_HOST.test(src)
      ? `<iframe data-type="video" src="${safeSrc}" frameborder="0" allowfullscreen></iframe>`
      : `<video src="${safeSrc}" controls></video>`;
  });

  // Images (before links)
  r = r.replace(IMAGE, (_, alt: string, src: string) => `<img src="${quoteAttribute(src)}" alt="${quoteAttribute(alt)}">`);

  // Obsidian-style attachment embeds: ![[filename.ext]]
  // Emit a placeholder element with the filename in data-attachment-name.
  // The async resolver (resolveAttachmentImagesInHtml) swaps in a real
  // signed URL before the editor mounts.
  r = r.replace(/!\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_, target, display) => {
    const name = String(target).trim();
    const alt = encodeAttribute(display || name);
    const safeName = encodeAttribute(name);
    const ext = name.includes(".") ? name.slice(name.lastIndexOf(".") + 1).toLowerCase() : "";
    const isImage = ["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "avif"].includes(ext);
    const isPdf = ext === "pdf";
    if (isImage) {
      return `<img src="" alt="${alt}" data-attachment-name="${safeName}">`;
    }
    if (isPdf) {
      return `<iframe data-type="pdf" src="about:blank" data-attachment-name="${safeName}" frameborder="0" title="${alt}"></iframe>`;
    }
    // Non-image attachments: render as a downloadable link placeholder.
    return `<a href="#" data-attachment-name="${safeName}" class="attachment-link">${alt}</a>`;
  });

  // Obsidian wikilinks. Title is lazy and may contain a stray `]` (stops at the
  // first `]]`); `|` still separates an optional display alias.
  r = r.replace(/\[\[([^[\n|]+?)(?:\|([^\]\n]+))?\]\]/g, (_, target, display) => {
    const label = display || target;
    return `<span data-wikilink="true" data-note-id="" data-note-title="${encodeAttribute(target)}" data-display-text="${encodeAttribute(display || "")}" class="wikilink-node" contenteditable="false">[[${label}]]</span>`;
  });

  // Legacy/attachment PDF links: `[Some File.pdf](#)` or `[X.pdf](https://…)`.
  // Convert to a PDF iframe so the embedded viewer shows up. When the href
  // is `#`, rely on the attachment resolver to fill in a signed URL via
  // the filename lookup; otherwise embed the URL directly.
  r = r.replace(PDF_LINK, (_, label, href) => {
    const name = String(label).trim();
    const safeName = encodeAttribute(name);
    if (href === "#" || href === "") {
      return `<iframe data-type="pdf" src="about:blank" data-attachment-name="${safeName}" frameborder="0" title="${safeName}"></iframe>`;
    }
    return `<iframe data-type="pdf" src="${encodeAttribute(href)}" data-attachment-name="${safeName}" frameborder="0" title="${safeName}"></iframe>`;
  });

  // Links
  r = r.replace(LINK, (_, label: string, href: string) => `<a href="${quoteAttribute(href)}">${label}</a>`);

  // Bold + italic
  r = r.replace(/\*\*\*(.+?)\*\*\*/g, "<strong><em>$1</em></strong>");
  r = r.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  r = r.replace(/\*(.+?)\*/g, "<em>$1</em>");
  // Strikethrough and highlight markers must touch their text (as in Obsidian):
  // "if x == 1 and y == 2" is prose, not a highlight of " 1 and y ".
  r = r.replace(/~~(\S(?:.*?\S)?)~~/g, "<del>$1</del>");
  r = r.replace(/==(\S(?:.*?\S)?)==/g, "<mark>$1</mark>");

  // Hard line breaks (two trailing spaces)
  r = r.replace(/ {2,}\n/g, "<br>");

  // Restore the backslash-escaped literals extracted at the top; `<` and `&`
  // as entities so they stay text.
  if (escaped.length) {
    r = r.replace(ESCAPE_TOKEN, (_m, i) => {
      const ch = escaped[Number(i)] ?? "";
      return ch === "<" ? "&lt;" : ch === "&" ? "&amp;" : ch;
    });
  }

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

function encodeAttribute(text: string): string {
  return encodeEntities(text).replace(/"/g, "&quot;");
}

// ─── Wikilinks ───────────────────────────────────────────────────────

// A title the wikilink parsers can read back: `[[`, `|` (alias separator), a
// `]` that would end the link, and line breaks cannot be written inside [[ ]].
const WIKILINK_SAFE_TITLE = /^[^[\]|\n]+$/;

/**
 * Append a link to another note at the end of a note's stored content, in the
 * content's own format. Markdown notes get `[[Title]]` on a line of its own;
 * raw HTML there made the whole note look like HTML on the next load. Legacy
 * HTML notes get the span the wikilink node parses, with its note id. A title
 * that cannot be written as a wikilink becomes a Markdown link to the note.
 * Content that already links the note is returned unchanged.
 */
export function appendWikilinkToContent(
  content: string | null | undefined,
  targetNoteId: string,
  targetNoteTitle: string,
): string {
  const existing = content ?? "";
  const title = targetNoteTitle.trim();

  if (looksLikeHtml(existing)) {
    if (existing.includes(`data-note-id="${encodeAttribute(targetNoteId)}"`)) return existing;
    const span = `<span data-wikilink="true" data-note-id="${encodeAttribute(targetNoteId)}" data-note-title="${encodeAttribute(title)}" data-display-text="" class="wikilink-node" contenteditable="false">[[${encodeEntities(title)}]]</span>`;
    return `${existing.trimEnd()}\n<p>${span}</p>`;
  }

  const lower = existing.toLowerCase();
  let link: string;
  if (WIKILINK_SAFE_TITLE.test(title)) {
    const needle = `[[${title.toLowerCase()}`;
    if (lower.includes(`${needle}]]`) || lower.includes(`${needle}|`)) return existing;
    link = `[[${title}]]`;
  } else {
    const href = `/dashboard/notes/${targetNoteId}`;
    if (existing.includes(`](${href})`)) return existing;
    link = `[${escapeMarkdownText(title.replace(/\s*\n\s*/g, " ")) || "Untitled"}](${href})`;
  }
  const body = existing.trimEnd();
  return body ? `${body}\n\n${link}` : link;
}

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
    frontmatter.menerio_metadata = encodeBase64Utf8(JSON.stringify(meta));
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
      metadata = JSON.parse(decodeBase64Utf8(fm.menerio_metadata));
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
  const fileName = sanitizeFileName(note.title || "Untitled");

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
