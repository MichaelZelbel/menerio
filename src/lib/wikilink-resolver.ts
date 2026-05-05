/**
 * Wikilink resolution helpers.
 *
 * Converts raw `[[Title]]` markdown patterns into the HTML structure that
 * `WikilinkExtension` parses back into a real Tiptap node, so existing notes
 * (or pasted markdown) get clickable, ID-bearing wikilinks again.
 */

const WIKILINK_REGEX = /\[\[([^\[\]\n]+?)\]\]/g;

export interface ResolvedWikilink {
  noteId: string | null;
  title: string;
}

/** Build lowercase title -> id lookup from a notes list. */
export function buildTitleMap(
  notes: Array<{ id: string; title: string | null }>
): Map<string, string> {
  const map = new Map<string, string>();
  for (const n of notes) {
    if (!n.title) continue;
    const key = n.title.trim().toLowerCase();
    if (key && !map.has(key)) map.set(key, n.id);
  }
  return map;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * Replace raw `[[Title]]` occurrences in HTML with WikilinkExtension-compatible
 * spans. Skips occurrences inside <pre>, <code> tags, or already-rendered
 * wikilink spans. If a title cannot be resolved, renders a `wikilink-broken`
 * span instead so users can spot dangling links.
 */
export function resolveWikilinksInHtml(
  html: string,
  titleMap: Map<string, string>
): string {
  if (!html || !html.includes("[[")) return html;

  // Mask zones where we should NOT substitute: existing wikilink spans, <pre>, <code>.
  const masks: string[] = [];
  const placeholder = (i: number) => `\u0000WL${i}\u0000`;

  let masked = html
    .replace(/<pre[\s\S]*?<\/pre>/gi, (m) => {
      masks.push(m);
      return placeholder(masks.length - 1);
    })
    .replace(/<code[\s\S]*?<\/code>/gi, (m) => {
      masks.push(m);
      return placeholder(masks.length - 1);
    })
    .replace(/<span[^>]*data-wikilink="true"[\s\S]*?<\/span>/gi, (m) => {
      masks.push(m);
      return placeholder(masks.length - 1);
    });

  masked = masked.replace(WIKILINK_REGEX, (_full, rawTitle: string) => {
    const title = rawTitle.trim();
    if (!title) return _full;
    const id = titleMap.get(title.toLowerCase());
    const safeTitle = escapeHtml(title);
    if (id) {
      return `<span data-wikilink="true" data-note-id="${id}" data-note-title="${safeTitle}" data-display-text="" class="wikilink-node" contenteditable="false">[[${safeTitle}]]</span>`;
    }
    return `<span class="wikilink-broken" data-wikilink-broken="true" title="No note found with this title">[[${safeTitle}]]</span>`;
  });

  // Restore masked zones.
  masked = masked.replace(/\u0000WL(\d+)\u0000/g, (_m, i) => masks[Number(i)] ?? "");

  return masked;
}

/** Extract distinct raw `[[Title]]` titles from markdown/plain text. */
export function extractWikilinkTitles(text: string): string[] {
  if (!text) return [];
  const out = new Set<string>();
  const re = /\[\[([^\[\]\n]+?)\]\]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const t = m[1].trim();
    if (t) out.add(t);
  }
  return [...out];
}
