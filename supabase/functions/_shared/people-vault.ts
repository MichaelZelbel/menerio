// Markdown page format for the People & Groups vault mirror.
// Pure module (no Deno/DB imports) so it is unit-testable and shared between
// github-people-sync (export) and github-sync-pull (parse-back).

import { parseFrontmatter, serializeFrontmatter } from "./frontmatter.ts";

export const PEOPLE_DIR = "People";
export const GROUPS_DIR = "Groups";

export const FACTS_START = "<!-- menerio:facts:start -->";
export const FACTS_END = "<!-- menerio:facts:end -->";
export const MEMBERS_START = "<!-- menerio:members:start -->";
export const MEMBERS_END = "<!-- menerio:members:end -->";

export const GROUP_TYPES = [
  "outreach", "relationship_care", "sales", "investors", "hiring",
  "research", "community", "learning", "creators", "other",
];

export class VaultParseError extends Error {}

export function sanitizeFileName(name: string): string {
  return name.replace(/[<>:"/\\|?*]/g, "").replace(/\s+/g, " ").trim().slice(0, 200) || "Untitled";
}

export function normalizePathPart(path: unknown): string {
  return String(path || "").replace(/^\/+|\/+$/g, "").replace(/\/+/g, "/").trim();
}

export function incrementPath(path: string, index: number): string {
  return path.replace(/\.md$/i, ` ${index}.md`);
}

export function buildPersonPath(vaultPath: string, name: string): string {
  const base = normalizePathPart(vaultPath);
  return [base, PEOPLE_DIR, `${sanitizeFileName(name)}.md`].filter(Boolean).join("/");
}

export function buildGroupPath(vaultPath: string, name: string): string {
  const base = normalizePathPart(vaultPath);
  return [base, GROUPS_DIR, `${sanitizeFileName(name)}.md`].filter(Boolean).join("/");
}

/**
 * True when `githubPath` already points at this entity name — same sanitized
 * file name, allowing a collision suffix (" 2"). Used for rename detection:
 * a differing name means the entity was renamed and the file must move.
 */
export function pathMatchesName(githubPath: string, name: string): boolean {
  const fileName = (githubPath.split("/").pop() || "").replace(/\.md$/i, "");
  const bare = fileName.replace(/ \d+$/, "");
  const expected = sanitizeFileName(name);
  return fileName === expected || bare === expected;
}

/**
 * True when two page renders differ only in the informational `modified:`
 * frontmatter line. Guards against commit noise from timestamp-only changes
 * (e.g. last_viewed_at touches bump contacts.updated_at without changing any
 * exported field).
 */
export function contentEffectivelyEqual(a: string, b: string): boolean {
  const strip = (s: string) => s.replace(/^modified: .*$/m, "").replace(/\r\n/g, "\n").trim();
  return strip(a) === strip(b);
}

/** Case/diacritics-insensitive name key, same scheme as group-note-import. */
export function normalizeName(value: string): string {
  return value.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
}

// ─── Person pages ────────────────────────────────────────────────────

export interface PersonPageData {
  contact: Record<string, unknown>;
  groupNames: string[];
  categories: Array<{ id: string; name: string; sort_order: number | null }>;
  entries: Array<{
    category_id: string | null;
    label: string;
    value: string;
    is_pinned: boolean;
    sort_order: number | null;
  }>;
}

function factLine(entry: { label: string; value: string }): string {
  return `- **${entry.label}:** ${entry.value}`;
}

function bySortOrder<T extends { sort_order: number | null }>(a: T, b: T): number {
  return (a.sort_order ?? 0) - (b.sort_order ?? 0);
}

export function buildPersonMarkdown(d: PersonPageData): string {
  const c = d.contact;

  const frontmatter = serializeFrontmatter([
    ["id", String(c.id)],
    ["type", "person"],
    ["name", String(c.name || "")],
    ["groups", [...d.groupNames].sort((a, b) => a.localeCompare(b))],
    ["company", (c.company as string) ?? null],
    ["role", (c.role as string) ?? null],
    ["relationship", (c.relationship as string) ?? null],
    ["email", (c.email as string) ?? null],
    ["phone", (c.phone as string) ?? null],
    ["tags", (c.tags as string[]) || []],
    ["aliases", (c.aliases as string[]) || []],
    ["favorite", !!c.is_favorite],
    ["sensitive", !!c.is_sensitive],
    ["created", c.created_at ? String(c.created_at) : undefined],
    ["modified", c.updated_at ? String(c.updated_at) : undefined],
  ]);

  const factsLines: string[] = [];
  const pinned = d.entries.filter((e) => e.is_pinned).sort(bySortOrder);
  if (pinned.length > 0) {
    factsLines.push("## Highlights");
    for (const e of pinned) factsLines.push(factLine(e));
  }
  const sortedCategories = [...d.categories].sort(
    (a, b) => bySortOrder(a, b) || a.name.localeCompare(b.name),
  );
  for (const cat of sortedCategories) {
    const catEntries = d.entries.filter((e) => e.category_id === cat.id).sort(bySortOrder);
    if (catEntries.length === 0) continue;
    factsLines.push(`## ${cat.name}`);
    for (const e of catEntries) factsLines.push(factLine(e));
  }

  const notes = String(c.notes || "").trim();

  return [
    frontmatter,
    "",
    `# ${String(c.name || "")}`,
    "",
    FACTS_START,
    ...factsLines,
    FACTS_END,
    "",
    "## Notes",
    ...(notes ? [notes] : []),
    "",
  ].join("\n");
}

export interface ParsedPersonFile {
  id: string | null;
  name: string | null;
  /** undefined = key absent in frontmatter (leave the field unchanged). */
  core: {
    company?: string | null;
    role?: string | null;
    relationship?: string | null;
    email?: string | null;
    phone?: string | null;
  };
  tags: string[] | null;
  aliases: string[] | null;
  /** null = groups key absent → membership unchanged. [] = clear all. */
  groups: string[] | null;
  favorite: boolean | null;
  sensitive: boolean | null;
  notesBody: string;
}

function asOptionalString(v: unknown): string | null | undefined {
  if (v === undefined) return undefined;
  const s = Array.isArray(v) ? v.join(", ") : String(v ?? "").trim();
  return s === "" ? null : s;
}

function asOptionalList(v: unknown): string[] | null {
  if (v === undefined) return null;
  if (Array.isArray(v)) return (v as unknown[]).map((x) => String(x).trim()).filter(Boolean);
  const s = String(v ?? "").trim();
  return s ? [s] : [];
}

function asOptionalBool(v: unknown): boolean | null {
  if (v === undefined) return null;
  if (typeof v === "boolean") return v;
  return String(v).trim() === "true";
}

/**
 * Extract the writable free-text region of a person page: everything after the
 * facts end-marker, minus the "## Notes" heading. When markers are absent
 * (only allowed for untracked files), the whole body minus a leading H1 is
 * used instead.
 */
function extractNotesBody(body: string, requireMarkers: boolean): string {
  const endIdx = body.indexOf(FACTS_END);
  if (endIdx === -1) {
    if (requireMarkers) {
      throw new VaultParseError(
        "Facts markers are missing or damaged — the page cannot be safely imported. Re-export from Menerio to restore the canonical layout.",
      );
    }
    const withoutHeading = body.replace(/^\s*#\s+[^\n]*\n?/, "");
    return withoutHeading.replace(/^\s*## Notes\s*\n?/m, "").trim();
  }
  const after = body.slice(endIdx + FACTS_END.length);
  return after.replace(/^\s*## Notes\s*\n?/, "").trim();
}

export function parsePersonMarkdown(content: string, opts?: { requireMarkers?: boolean }): ParsedPersonFile {
  const requireMarkers = opts?.requireMarkers ?? true;
  const { data, body, hasFrontmatter } = parseFrontmatter(content);
  if (!hasFrontmatter && requireMarkers) {
    throw new VaultParseError("Frontmatter block is missing — the page cannot be safely imported.");
  }

  return {
    id: typeof data.id === "string" && data.id.trim() ? data.id.trim() : null,
    name: asOptionalString(data.name) ?? null,
    core: {
      company: asOptionalString(data.company),
      role: asOptionalString(data.role),
      relationship: asOptionalString(data.relationship),
      email: asOptionalString(data.email),
      phone: asOptionalString(data.phone),
    },
    tags: asOptionalList(data.tags),
    aliases: asOptionalList(data.aliases),
    groups: asOptionalList(data.groups),
    favorite: asOptionalBool(data.favorite),
    sensitive: asOptionalBool(data.sensitive),
    notesBody: extractNotesBody(body, requireMarkers),
  };
}

// ─── Group pages ─────────────────────────────────────────────────────

export interface GroupPageData {
  group: Record<string, unknown>;
  parentName: string | null;
  members: Array<{
    name: string;
    status: string | null;
    priority: string | null;
    reason: string | null;
  }>;
}

function tableCell(value: string | null): string {
  return String(value || "").replace(/\|/g, "\\|").replace(/\r?\n/g, " ").trim();
}

export function buildGroupMarkdown(d: GroupPageData): string {
  const g = d.group;

  const frontmatter = serializeFrontmatter([
    ["id", String(g.id)],
    ["type", "group"],
    ["name", String(g.name || "")],
    ["parent", d.parentName ?? null],
    ["group_type", String(g.type || "other")],
    ["sensitivity", String(g.sensitivity || "normal")],
    ["created", g.created_at ? String(g.created_at) : undefined],
    ["modified", g.updated_at ? String(g.updated_at) : undefined],
  ]);

  const memberLines: string[] = [];
  if (d.members.length > 0) {
    memberLines.push("| Member | Status | Priority | Reason |");
    memberLines.push("| --- | --- | --- | --- |");
    for (const m of d.members) {
      memberLines.push(
        `| [[${tableCell(m.name)}]] | ${tableCell(m.status)} | ${tableCell(m.priority)} | ${tableCell(m.reason)} |`,
      );
    }
  } else {
    memberLines.push("_No members yet._");
  }

  const purpose = String(g.purpose || "").trim();
  const description = String(g.description || "").trim();

  return [
    frontmatter,
    "",
    `# ${String(g.name || "")}`,
    "",
    "## Purpose",
    ...(purpose ? [purpose] : []),
    "",
    MEMBERS_START,
    ...memberLines,
    MEMBERS_END,
    "",
    "## Description",
    ...(description ? [description] : []),
    "",
  ].join("\n");
}

export interface ParsedGroupFile {
  id: string | null;
  name: string | null;
  /** undefined = parent key absent → unchanged. null = explicit empty → clear. */
  parent: string | null | undefined;
  groupType: string | null;
  sensitivity: string | null;
  purpose: string;
  description: string;
}

export function parseGroupMarkdown(content: string, opts?: { requireMarkers?: boolean }): ParsedGroupFile {
  const requireMarkers = opts?.requireMarkers ?? true;
  const { data, body, hasFrontmatter } = parseFrontmatter(content);
  if (!hasFrontmatter && requireMarkers) {
    throw new VaultParseError("Frontmatter block is missing — the page cannot be safely imported.");
  }

  let purpose = "";
  let description = "";
  const startIdx = body.indexOf(MEMBERS_START);
  const endIdx = body.indexOf(MEMBERS_END);

  if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
    const beforeMembers = body.slice(0, startIdx);
    const afterMembers = body.slice(endIdx + MEMBERS_END.length);
    purpose = extractSection(beforeMembers, "Purpose");
    description = extractSection(afterMembers, "Description");
  } else if (requireMarkers) {
    throw new VaultParseError(
      "Members markers are missing or damaged — the page cannot be safely imported. Re-export from Menerio to restore the canonical layout.",
    );
  } else {
    purpose = extractSection(body, "Purpose");
    description = extractSection(body, "Description");
  }

  return {
    id: typeof data.id === "string" && data.id.trim() ? data.id.trim() : null,
    name: asOptionalString(data.name) ?? null,
    parent: data.parent === undefined ? undefined : asOptionalString(data.parent) ?? null,
    groupType: asOptionalString(data.group_type) ?? null,
    sensitivity: asOptionalString(data.sensitivity) ?? null,
    purpose,
    description,
  };
}

/** Text under "## <heading>" up to the next "## " heading or end of input. */
function extractSection(text: string, heading: string): string {
  const re = new RegExp(`^##\\s+${heading}\\s*$`, "m");
  const m = re.exec(text);
  if (!m) return text.includes("## ") ? "" : text.trim();
  const start = m.index + m[0].length;
  const rest = text.slice(start);
  const next = rest.search(/^##\s+/m);
  return (next === -1 ? rest : rest.slice(0, next)).trim();
}
