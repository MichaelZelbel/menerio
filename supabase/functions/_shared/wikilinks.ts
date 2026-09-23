/**
 * `[[Exact Title]]` in a note body becomes a `manual_link` row, server side.
 *
 * Until this file the only thing that turned wikilink text into a connection
 * was the editor: NoteEditor's save path (`syncManualLinks`) and the one-off
 * `backfill-wikilinks` function. process-note never did, so a note written
 * through MCP could say `[[Ownward Studio]]` all it liked and the graph, the
 * backlinks panel and get_connected_notes saw nothing until the user happened
 * to open that note and type in it. An assistant had no way to link two notes
 * on purpose. This is the same resolution the editor does, for writers that
 * have no editor.
 *
 * Rules, all taken from the two existing implementations:
 *  - the pattern is backfill-wikilinks' (`[[Title]]`, no `[` `]` or newline
 *    inside), and a title matches case-insensitively after trimming;
 *  - only the user's own, untrashed, AI-visible notes can be targets, so a link
 *    can never confirm that a hidden note exists;
 *  - a duplicated title resolves to the oldest note, every time, and to a note
 *    the user wrote before a mirrored mission control file of the same name;
 *  - a note never links to itself.
 *
 * It ADDS links. It removes only rows this file created earlier (marked in
 * metadata) whose wikilink has since left the body, so a link the user drew by
 * hand in the app is never touched by an assistant's edit.
 *
 * Pure on purpose: no Deno APIs in this file, so the Node test runner can
 * import it directly.
 */
import { escapeLike } from "./postgrest-filters.ts";
import { isGodspeedMirror } from "./mc-source.ts";
import type { DbClient } from "./db-client.ts";

const WIKILINK_REGEX = /\[\[([^[\]\n]+?)\]\]/g;

/** Marks a manual_link row as derived from body text by this module. */
export const WIKILINK_SOURCE = "wikilink-sync";

/** A body is scanned for at most this many distinct titles. */
const MAX_WIKILINKS_PER_NOTE = 50;

/**
 * Distinct wikilink titles in reading order, trimmed, compared case-insensitively.
 *
 * `[[Title|shown text]]`, `[[Title#Heading]]` and `[[Title#^block]]` all point
 * at the note called Title. The whole inner text used to be taken as the
 * title, so every aliased or heading link was reported unresolved and never
 * became a connection. `[[#Heading]]` is a link inside the same note: skipped.
 */
export function extractWikilinkTitles(content: string | null | undefined): string[] {
  const text = String(content ?? "");
  if (!text.includes("[[")) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const m of text.matchAll(WIKILINK_REGEX)) {
    const title = m[1].split("|")[0].split("#")[0].trim();
    const key = title.toLowerCase();
    if (!title || seen.has(key)) continue;
    seen.add(key);
    out.push(title);
    if (out.length >= MAX_WIKILINKS_PER_NOTE) break;
  }
  return out;
}

export interface WikilinkSyncResult {
  /** Titles that resolved to a note, with the note they resolved to. */
  linked: { title: string; note_id: string }[];
  /** Titles no visible note carries. Reported so the writer can fix the spelling. */
  unresolved: string[];
  /** Rows newly inserted by this call. */
  added: number;
  /** Rows this module created earlier and removed because the wikilink is gone. */
  removed: number;
}

interface TitleRow { id: string; title: string | null; source_app?: string | null; created_at?: string | null }

/** Oldest first, a native note before a mission control file: the same note wins on every run. */
function pickTarget(rows: TitleRow[]): TitleRow | undefined {
  return [...rows].sort((a, b) =>
    (Number(isGodspeedMirror(a.source_app)) - Number(isGodspeedMirror(b.source_app))) ||
    String(a.created_at ?? "").localeCompare(String(b.created_at ?? "")) ||
    String(a.id).localeCompare(String(b.id))
  )[0];
}

interface LinkRow { id: string; target_note_id: string; metadata: { source?: string } | null }

export async function syncWikilinkConnections(
  db: DbClient,
  userId: string,
  noteId: string,
  content: string | null | undefined,
): Promise<WikilinkSyncResult> {
  const titles = extractWikilinkTitles(content);
  const linked: { title: string; note_id: string }[] = [];
  const unresolved: string[] = [];

  const candidates = () =>
    db.from("notes")
      .select("id, title, source_app, created_at")
      .eq("user_id", userId)
      .eq("is_trashed", false)
      .eq("ai_visibility", "visible");

  if (titles.length > 0) {
    // One query answers every title that is spelled exactly; only the rest
    // cost a case-insensitive lookup each.
    const { data: exact } = await candidates().in("title", titles);
    const byLower = new Map<string, TitleRow[]>();
    for (const r of (exact || []) as TitleRow[]) {
      const k = String(r.title ?? "").trim().toLowerCase();
      if (!k) continue;
      if (!byLower.has(k)) byLower.set(k, []);
      byLower.get(k)!.push(r);
    }

    for (const title of titles) {
      let rows = byLower.get(title.toLowerCase());
      if (!rows) {
        const { data } = await candidates().ilike("title", escapeLike(title)).limit(10);
        rows = (data || []) as TitleRow[];
      }
      const target = pickTarget(rows.filter((r) => r.id !== noteId));
      if (target) linked.push({ title, note_id: target.id });
      else unresolved.push(title);
    }
  }

  const { data: existing } = await db
    .from("note_connections")
    .select("id, target_note_id, metadata")
    .eq("user_id", userId)
    .eq("source_note_id", noteId)
    .eq("connection_type", "manual_link");

  const wanted = new Set(linked.map((l) => l.note_id));
  const current = (existing || []) as LinkRow[];
  const have = new Set(current.map((e) => e.target_note_id));

  const stale = current
    .filter((e) => e.metadata?.source === WIKILINK_SOURCE && !wanted.has(e.target_note_id))
    .map((e) => e.id);
  let removed = 0;
  if (stale.length > 0) {
    const { error } = await db.from("note_connections").delete().in("id", stale);
    if (!error) removed = stale.length;
  }

  const rows = [...wanted].filter((id) => !have.has(id)).map((targetId) => ({
    user_id: userId,
    source_note_id: noteId,
    target_note_id: targetId,
    connection_type: "manual_link",
    strength: 1.0,
    metadata: { source: WIKILINK_SOURCE },
  }));
  let added = 0;
  if (rows.length > 0) {
    // The table is unique on (source, target, type). The editor may be saving
    // the same note at the same moment; losing that race is not a failure.
    const { error } = await db
      .from("note_connections")
      .upsert(rows, { onConflict: "source_note_id,target_note_id,connection_type", ignoreDuplicates: true });
    if (error) console.warn("wikilink sync: insert failed:", error.message);
    else added = rows.length;
  }

  return { linked, unresolved, added, removed };
}
