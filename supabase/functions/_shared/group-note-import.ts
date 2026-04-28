type SupabaseAdmin = any;

type ImportableNote = { id: string; title?: string | null; content?: string | null; metadata?: Record<string, unknown> | null; created_at?: string | null };
type ImportableGroup = { id: string; name: string; description?: string | null; purpose?: string | null; stages?: unknown };

type ParsedMemberRow = {
  rank: number;
  name: string;
  link?: string | null;
  relevance?: string | null;
  firstStep?: string | null;
  sourceRow: Record<string, string>;
};

const NAME_HEADERS = ["name", "person", "people", "creator", "contact", "member", "profil", "profile", "account", "wer"];
const RANK_HEADERS = ["#", "no", "nr", "rank", "ranking", "position", "pos", "nummer"];
const LINK_HEADERS = ["link", "url", "website", "profile", "profil", "x", "twitter", "linkedin", "youtube"];
const RELEVANCE_HEADERS = ["why", "relevance", "relevant", "reason", "warum", "begründung", "fit", "notes"];
const STEP_HEADERS = ["first step", "next step", "action", "erster schritt", "nächster schritt", "konkreter erster schritt", "outreach"];

function normalize(value: string) {
  return value.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
}

function headerScore(header: string, candidates: string[]) {
  const h = normalize(header);
  return candidates.some((candidate) => h === normalize(candidate) || h.includes(normalize(candidate))) ? 1 : 0;
}

function splitMarkdownRow(line: string) {
  return line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((cell) => cell.trim());
}

function stripMarkdown(value = "") {
  return value
    .replace(/<a\s+[^>]*href=["']([^"']+)["'][^>]*>(.*?)<\/a>/gi, "$2 ($1)")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1")
    .replace(/[*_`~]/g, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function firstUrl(value = "") {
  const markdown = value.match(/\[[^\]]+\]\((https?:\/\/[^)\s]+)\)/i)?.[1];
  if (markdown) return markdown;
  return value.match(/https?:\/\/[^\s)]+/i)?.[0] || null;
}

function nameFromCell(value = "") {
  const markdownName = value.match(/\[([^\]]+)\]\(https?:\/\/[^)\s]+\)/i)?.[1];
  const cleaned = stripMarkdown(markdownName || value).replace(/https?:\/\/\S+/gi, "").trim();
  return cleaned.replace(/^\d+[.)\-\s]+/, "").trim();
}

function parseMarkdownTables(content = ""): ParsedMemberRow[] {
  const lines = content.split(/\r?\n/);
  const rows: ParsedMemberRow[] = [];

  for (let i = 0; i < lines.length - 1; i++) {
    if (!lines[i].includes("|") || !/^\s*\|?\s*:?-{3,}/.test(lines[i + 1])) continue;
    const headers = splitMarkdownRow(lines[i]);
    const rankIndex = headers.findIndex((h) => headerScore(h, RANK_HEADERS));
    const linkIndex = headers.findIndex((h) => headerScore(h, LINK_HEADERS));
    const relevanceIndex = headers.findIndex((h) => headerScore(h, RELEVANCE_HEADERS));
    const firstStepIndex = headers.findIndex((h) => headerScore(h, STEP_HEADERS));
    let nameIndex = headers.findIndex((h) => headerScore(h, NAME_HEADERS));
    if (nameIndex < 0) nameIndex = headers.findIndex((_, idx) => idx !== rankIndex && idx !== linkIndex && idx !== relevanceIndex && idx !== firstStepIndex);
    if (nameIndex < 0) continue;

    let rowIndex = i + 2;
    while (rowIndex < lines.length && lines[rowIndex].includes("|")) {
      const cells = splitMarkdownRow(lines[rowIndex]);
      const sourceRow = Object.fromEntries(headers.map((header, idx) => [stripMarkdown(header) || `column_${idx + 1}`, stripMarkdown(cells[idx] || "")]));
      const rawName = cells[nameIndex] || "";
      const name = nameFromCell(rawName);
      if (name && name.length <= 140) {
        const parsedRank = Number(stripMarkdown(cells[rankIndex] || ""));
        rows.push({
          rank: Number.isFinite(parsedRank) && parsedRank > 0 ? parsedRank : rows.length + 1,
          name,
          link: firstUrl(cells[linkIndex] || rawName),
          relevance: relevanceIndex >= 0 ? stripMarkdown(cells[relevanceIndex] || "") || null : null,
          firstStep: firstStepIndex >= 0 ? stripMarkdown(cells[firstStepIndex] || "") || null : null,
          sourceRow,
        });
      }
      rowIndex++;
    }
    i = rowIndex;
  }

  return rows;
}

function parseNumberedList(content = ""): ParsedMemberRow[] {
  return content.split(/\r?\n/).flatMap((line) => {
    const match = line.match(/^\s*(\d{1,4})[.)]\s+(.{2,220})$/);
    if (!match) return [];
    const name = nameFromCell(match[2].split(/\s[-–—]\s|\s\|\s|:/)[0]);
    if (!name) return [];
    return [{ rank: Number(match[1]), name, link: firstUrl(match[2]), relevance: null, firstStep: null, sourceRow: { line: stripMarkdown(match[2]) } }];
  });
}

function scoreSourceNote(group: ImportableGroup, note: ImportableNote) {
  const groupName = normalize(group.name);
  const title = normalize(note.title || "");
  const content = normalize((note.content || "").slice(0, 5000));
  let score = 0;
  if (title === groupName) score += 12;
  if (title.includes(groupName) || groupName.includes(title)) score += 6;
  for (const token of groupName.split(" ").filter((token) => token.length > 2)) {
    if (title.includes(token)) score += 2;
    if (content.includes(token)) score += 1;
  }
  if ((note.content || "").includes("|")) score += 3;
  return score;
}

export function previewGroupMembersFromNotes(group: ImportableGroup, notes: ImportableNote[]) {
  const rankedNotes = notes
    .map((note) => ({ note, score: scoreSourceNote(group, note), rows: [...parseMarkdownTables(note.content || ""), ...parseNumberedList(note.content || "")] }))
    .filter((item) => item.rows.length > 0 && item.score >= 3)
    .sort((a, b) => b.score - a.score || b.rows.length - a.rows.length);
  const best = rankedNotes[0];
  if (!best) return null;
  const seen = new Set<string>();
  const rows = best.rows.filter((row) => {
    const key = normalize(row.name);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  }).sort((a, b) => a.rank - b.rank);
  return { note: best.note, score: best.score, rows };
}

export async function importGroupMembersFromNotes(admin: SupabaseAdmin, userId: string, group: ImportableGroup, notes: ImportableNote[]) {
  const preview = previewGroupMembersFromNotes(group, notes);
  if (!preview || preview.rows.length < 2) return null;

  const [{ data: contacts }, { data: memberships }] = await Promise.all([
    admin.from("contacts").select("id, name, aliases, metadata").eq("user_id", userId).is("merged_into", null),
    admin.from("contact_group_memberships").select("id, person_id, source_note_ids, attributes, position").eq("user_id", userId).eq("group_id", group.id).is("archived_at", null),
  ]);

  const contactsByName = new Map<string, any>();
  for (const contact of contacts || []) {
    contactsByName.set(normalize(contact.name), contact);
    for (const alias of contact.aliases || []) contactsByName.set(normalize(alias), contact);
  }
  const membershipsByPerson = new Map((memberships || []).map((membership: any) => [membership.person_id, membership]));
  const defaultStatus = Array.isArray(group.stages) ? (group.stages as any[])[0]?.id : null;
  const maxPosition = Math.max(0, ...(memberships || []).map((membership: any) => Number(membership.position || 0)));
  let createdContacts = 0;
  let createdMemberships = 0;
  let updatedMemberships = 0;
  const imported: any[] = [];

  for (const [index, row] of preview.rows.entries()) {
    let contact = contactsByName.get(normalize(row.name));
    if (!contact) {
      const { data, error } = await admin.from("contacts").insert({
        user_id: userId,
        name: row.name,
        metadata: { source: "group_note_import", source_note_id: preview.note.id, source_url: row.link || null },
        notes: row.relevance || null,
      }).select("id, name, aliases, metadata").single();
      if (error) throw error;
      contact = data;
      contactsByName.set(normalize(row.name), contact);
      createdContacts++;
    }

    const attributes = { rank: row.rank, source_link: row.link || null, first_step: row.firstStep || null, imported_columns: row.sourceRow };
    const noteLine = [row.firstStep ? `First step: ${row.firstStep}` : null, row.link ? `Link: ${row.link}` : null].filter(Boolean).join("\n");
    const existing = membershipsByPerson.get(contact.id);
    if (existing) {
      const sourceIds = Array.from(new Set([...(existing.source_note_ids || []), preview.note.id]));
      const { error } = await admin.from("contact_group_memberships").update({
        position: row.rank || existing.position || maxPosition + index + 1,
        reason: row.relevance || null,
        notes: noteLine || null,
        attributes: { ...(existing.attributes || {}), ...attributes },
        source_note_ids: sourceIds,
        updated_at: new Date().toISOString(),
      }).eq("id", existing.id).eq("user_id", userId);
      if (error) throw error;
      updatedMemberships++;
      imported.push({ contact_id: contact.id, name: contact.name, membership_id: existing.id, rank: row.rank, updated: true });
    } else {
      const { data, error } = await admin.from("contact_group_memberships").insert({
        user_id: userId,
        group_id: group.id,
        person_id: contact.id,
        status: defaultStatus || null,
        position: row.rank || maxPosition + index + 1,
        reason: row.relevance || null,
        notes: noteLine || null,
        attributes,
        source_note_ids: [preview.note.id],
      }).select("id").single();
      if (error) throw error;
      createdMemberships++;
      imported.push({ contact_id: contact.id, name: contact.name, membership_id: data.id, rank: row.rank, updated: false });
    }
  }

  return { source_note: { id: preview.note.id, title: preview.note.title || "Untitled" }, parsed_rows: preview.rows.length, created_contacts: createdContacts, imported_members: createdMemberships, updated_members: updatedMemberships, members: imported };
}