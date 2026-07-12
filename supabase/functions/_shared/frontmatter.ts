// YAML-frontmatter parsing/serialization for vault markdown files.
// Superset of the parser previously inlined in github-sync-pull: it also
// understands block-style sequences ("key:\n  - item"), which is the format
// Obsidian's Properties editor writes — the inline-only parser would silently
// read such lists as empty.

export interface ParsedFrontmatter {
  /** Parsed key/value data. Lists become string[]. */
  data: Record<string, unknown>;
  /** Markdown body after the closing --- fence. */
  body: string;
  /** False when the content had no frontmatter block at all. */
  hasFrontmatter: boolean;
}

function parseScalar(raw: string): unknown {
  let val = raw.trim();
  if (val === "true") return true;
  if (val === "false") return false;
  if (val.startsWith("[") && val.endsWith("]")) {
    return val
      .slice(1, -1)
      .split(",")
      .map((s) => s.trim().replace(/^["']|["']$/g, ""))
      .filter(Boolean);
  }
  if (
    (val.startsWith('"') && val.endsWith('"') && val.length >= 2) ||
    (val.startsWith("'") && val.endsWith("'") && val.length >= 2)
  ) {
    val = val.slice(1, -1);
    return val.replace(/\\"/g, '"');
  }
  return val;
}

export function parseFrontmatter(content: string): ParsedFrontmatter {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) return { data: {}, body: content, hasFrontmatter: false };

  const data: Record<string, unknown> = {};
  const lines = match[1].split(/\r?\n/);

  for (let i = 0; i < lines.length; i++) {
    const kv = lines[i].match(/^([A-Za-z_][\w-]*)\s*:\s*(.*)$/);
    if (!kv) continue;
    const key = kv[1];
    const rawValue = kv[2].trim();

    if (rawValue === "") {
      // Possibly a block-style sequence: collect following "- item" lines.
      const items: string[] = [];
      let j = i + 1;
      while (j < lines.length) {
        const itemMatch = lines[j].match(/^\s+-\s*(.*)$/);
        if (!itemMatch) break;
        const item = String(parseScalar(itemMatch[1]) ?? "").trim();
        if (item) items.push(item);
        j++;
      }
      if (j > i + 1) {
        data[key] = items;
        i = j - 1;
      } else {
        data[key] = "";
      }
      continue;
    }

    data[key] = parseScalar(rawValue);
  }

  return { data, body: match[2], hasFrontmatter: true };
}

/** True when a plain string can be emitted unquoted (uuids, ISO dates, slugs). */
function isSafeUnquoted(value: string): boolean {
  return /^[A-Za-z0-9_.:+-]+$/.test(value) && value !== "true" && value !== "false";
}

function quote(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function serializeValue(value: unknown): string {
  if (typeof value === "boolean" || typeof value === "number") return String(value);
  if (Array.isArray(value)) {
    return `[${value.map((v) => quote(String(v))).join(", ")}]`;
  }
  const str = String(value ?? "");
  if (str === "") return '""';
  return isSafeUnquoted(str) ? str : quote(str);
}

/**
 * Serialize ordered [key, value] pairs into a frontmatter block (including the
 * --- fences). Entries whose value is `undefined` are skipped; `null` becomes
 * an explicit empty string (present-but-empty round-trips as "clear field").
 */
export function serializeFrontmatter(fields: Array<[string, unknown]>): string {
  const lines = ["---"];
  for (const [key, value] of fields) {
    if (value === undefined) continue;
    lines.push(`${key}: ${serializeValue(value === null ? "" : value)}`);
  }
  lines.push("---");
  return lines.join("\n");
}
