/**
 * The parts of MCP `capture_note` and `list_note_folders` that can be reasoned
 * about without a server: what the note is called, which tags it carries, which
 * folders exist and how full they are, which existing notes the new one sits
 * closest to, and the receipt the assistant reads back.
 *
 * capture_note used to take `{content}` and nothing else. Every note an
 * assistant wrote landed at the top level under its own first line, and the
 * receipt named neither the note nor where it went, so "put that in my Health
 * folder" could not be done and could not be checked. Filing is now part of the
 * call, and the receipt states what happened in terms the assistant can verify.
 *
 * Pure on purpose: no Deno APIs in this file, so the Node test runner can
 * import it directly.
 */
import { isHubMirror } from "./hub-source.ts";
import { compareNativeFirst, isHubFolderPath, rankingSimilarity } from "./hub-ranking.ts";
import { normalizeFolderPath } from "./note-create-tools.ts";
import type { DbClient } from "./db-client.ts";

const MAX_TITLE_CHARS = 200;
const MAX_TAGS = 20;
export const MAX_RELATED_NOTES = 5;
const RELATED_MATCH_THRESHOLD = 0.3;
const RELATED_CANDIDATE_CHUNKS = 40;

/**
 * The given title, or the note's first line the way capture_note has always
 * derived one (cut at 80 characters), so an assistant that passes no title gets
 * exactly the note it got before.
 */
export function captureTitle(content: string, title?: string | null): string {
  const given = String(title ?? "").replace(/\s+/g, " ").trim();
  if (given) return given.slice(0, MAX_TITLE_CHARS);
  const firstLine = String(content ?? "").split("\n")[0];
  return firstLine.length > 80 ? firstLine.substring(0, 77) + "..." : firstLine;
}

/**
 * The caller's tags first, then the AI topics, without repeats. Compared
 * case-insensitively, keeping the first spelling: the caller chose a tag
 * because the user uses it, and "Health" beside "health" is two tags in the UI.
 */
export function mergeTags(given: unknown, topics: unknown): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const list of [given, topics]) {
    if (!Array.isArray(list)) continue;
    for (const raw of list) {
      const tag = String(raw ?? "").trim();
      const key = tag.toLowerCase();
      if (!tag || seen.has(key)) continue;
      seen.add(key);
      out.push(tag);
    }
  }
  return out.slice(0, MAX_TAGS);
}

export interface RelatedNote {
  id: string;
  title: string;
  similarity: number;
}

/**
 * The user's existing notes closest to an embedding that was just computed.
 *
 * Costs no tokens: the vector is the new note's own, handed in by the caller.
 * Native notes are preferred by the shared hub policy (a mirrored file competes
 * on a discounted similarity and loses ties), because "related to what you
 * already wrote" is the useful answer and the mirror would otherwise fill the
 * list by volume. Trashed and AI-hidden notes are never listed.
 */
export async function findRelatedNotes(
  db: DbClient,
  userId: string,
  embedding: number[],
  excludeNoteId: string,
  max = MAX_RELATED_NOTES,
): Promise<RelatedNote[]> {
  const { data, error } = await db.rpc("match_note_chunks", {
    query_embedding: embedding,
    match_threshold: RELATED_MATCH_THRESHOLD,
    match_count: RELATED_CANDIDATE_CHUNKS,
    p_user_id: userId,
  });
  if (error || !Array.isArray(data)) return [];

  const best = new Map<string, number>();
  for (const c of data as { note_id: string; similarity: number }[]) {
    if (c.note_id === excludeNoteId) continue;
    if ((best.get(c.note_id) ?? -1) < c.similarity) best.set(c.note_id, c.similarity);
  }
  if (best.size === 0) return [];

  // The RPC already drops trashed notes; hydration repeats it together with
  // the owner and the visibility check, since this list is shown to a model.
  const { data: rows } = await db
    .from("notes")
    .select("id, title, source_app")
    .eq("user_id", userId)
    .eq("is_trashed", false)
    .eq("ai_visibility", "visible")
    .in("id", Array.from(best.keys()));

  return ((rows || []) as { id: string; title: string | null; source_app: string | null }[])
    .map((r) => ({ ...r, similarity: best.get(r.id)! }))
    .sort((a, b) =>
      ((rankingSimilarity(b.similarity, b.source_app) ?? 0) - (rankingSimilarity(a.similarity, a.source_app) ?? 0)) ||
      compareNativeFirst(a.source_app, b.source_app))
    .slice(0, max)
    .map((r) => ({
      id: r.id,
      title: `${r.title || "Untitled"}${isHubMirror(r.source_app) ? " [hub file]" : ""}`,
      similarity: r.similarity,
    }));
}

export type IndexingState = "indexed" | "deferred_no_credits" | "failed" | "pending";

export interface CaptureReceipt {
  noteId: string;
  title: string;
  folderPath: string;
  foldersCreated: string[];
  tags: string[];
  metadata: Record<string, unknown>;
  indexing: IndexingState;
  related: RelatedNote[];
  wikilinks: { linked: { title: string; note_id: string }[]; unresolved: string[] };
}

/** What capture_note answers. Plain lines, because a model reads it, not a parser. */
export function formatCaptureReceipt(r: CaptureReceipt): string {
  const lines: string[] = [];
  const m = r.metadata || {};
  lines.push(`Captured as ${(m.type as string) || "note"}.`);
  lines.push(`ID: ${r.noteId}`);
  lines.push(`Title: ${r.title || "Untitled"}`);
  lines.push(
    `Folder: ${r.folderPath || "top level"}` +
      (r.foldersCreated.length ? ` (new folder created: ${r.foldersCreated.join(", ")})` : ""),
  );
  if (r.tags.length) lines.push(`Tags: ${r.tags.join(", ")}`);
  if (Array.isArray(m.people) && m.people.length) lines.push(`People: ${(m.people as string[]).join(", ")}`);
  if (Array.isArray(m.action_items) && m.action_items.length) lines.push(`Actions: ${(m.action_items as string[]).join("; ")}`);

  if (r.wikilinks.linked.length) {
    lines.push(`Linked via [[wikilinks]]: ${r.wikilinks.linked.map((l) => `${l.title} (${l.note_id})`).join("; ")}`);
  }
  if (r.wikilinks.unresolved.length) {
    lines.push(`No note has these [[wikilink]] titles, so no link was made: ${r.wikilinks.unresolved.join("; ")}. A wikilink needs the exact title of an existing note.`);
  }

  if (r.indexing === "deferred_no_credits") {
    lines.push("Related notes: not available. Indexing was deferred because the account is out of AI credits; the note is saved and will be indexed and linked once credits are back.");
  } else if (r.indexing === "failed" || r.indexing === "pending") {
    lines.push("Related notes: not available yet. The note is saved; indexing did not finish in this call and a background job will retry it.");
  } else if (r.related.length === 0) {
    lines.push("Related notes: none close enough among the user's existing notes.");
  } else {
    lines.push("Most related existing notes:");
    for (const n of r.related) lines.push(`- ${n.title} (${n.id}), ${(n.similarity * 100).toFixed(0)}% similar`);
  }

  lines.push("Menerio links related notes on its own in the background (shared people, shared topics, similar meaning), so nothing more is needed for that. To link notes explicitly, write [[Exact Title]] in a note body.");
  return lines.join("\n");
}
export interface FolderListing {
  folders: { path: string; notes: number; notes_including_subfolders: number }[];
  top_level_notes: number;
  folder_count: number;
  hub_mirror_included: boolean;
}

/**
 * Every folder the user has, with how many notes sit in it, sorted by path.
 *
 * Two sources, because the note tree in the app has two: a `note_folders` row
 * (a folder can exist and be empty) and the `folder_path` of the notes
 * themselves (a note can sit in a path nobody ever made a row for). A note in
 * "A/B/C" makes "A" and "A/B" exist too.
 *
 * The hub mirror's tree is left out unless asked for. It is hundreds of
 * machine-made folders, nothing may be filed there, and an assistant choosing
 * where a new note belongs would otherwise have to read past all of them.
 */
export function buildFolderListing(
  folderPaths: (string | null | undefined)[],
  noteFolderPaths: (string | null | undefined)[],
  includeHub = false,
): FolderListing {
  const direct = new Map<string, number>();
  const known = new Set<string>();
  let topLevel = 0;

  const admit = (p: string) => includeHub || !isHubFolderPath(p);
  const addWithAncestors = (p: string) => {
    const segs = p.split("/");
    for (let i = 1; i <= segs.length; i++) known.add(segs.slice(0, i).join("/"));
  };

  for (const raw of folderPaths) {
    const p = normalizeFolderPath(raw);
    if (p && admit(p)) addWithAncestors(p);
  }
  for (const raw of noteFolderPaths) {
    const p = normalizeFolderPath(raw);
    if (!p) { topLevel += 1; continue; }
    if (!admit(p)) continue;
    addWithAncestors(p);
    direct.set(p, (direct.get(p) ?? 0) + 1);
  }

  const paths = [...known].sort((a, b) => a.localeCompare(b));
  const folders = paths.map((path) => {
    let deep = 0;
    for (const [p, n] of direct) if (p === path || p.startsWith(`${path}/`)) deep += n;
    return { path, notes: direct.get(path) ?? 0, notes_including_subfolders: deep };
  });

  return { folders, top_level_notes: topLevel, folder_count: folders.length, hub_mirror_included: includeHub };
}
