/**
 * Combined note search for callers that hold an API key, not a user session.
 *
 * `mc-api-notes` GET /search used to be a bare ILIKE: a question phrased any
 * other way than the note was written found nothing, which is the one thing a
 * search by meaning exists to fix. The app's semantic search lives in another
 * edge function that wants a user token, and the call to it that once sat in
 * Mission Control API answered 401 on every request. So the search runs here, in
 * process, on the two arms every other search surface already uses:
 *
 *   vector arm   the query embedding against `match_note_chunks`
 *   text arm     ILIKE over title and content, which also finds a note whose
 *                chunks have not been embedded yet
 *
 * merged per note and ordered by the shared policy in `mc-ranking.ts`.
 *
 * It never fails for want of an embedding. No credits, a provider outage, an
 * RPC error: each one drops the vector arm and the answer says `text_only`, so
 * a caller can tell a thin result from a search that could not look by meaning.
 *
 * Pure on purpose: no Deno APIs and no network in this file. The embedding call
 * is injected, so the Node test runner can import this directly.
 */
import { ilikeAnyColumn } from "./postgrest-filters.ts";
import { isGodspeedMirror } from "./mc-source.ts";
import { rankHybridRows } from "./mc-ranking.ts";
import type { DbClient } from "./db-client.ts";

export const SEARCH_DEFAULT_LIMIT = 10;
export const SEARCH_MAX_LIMIT = 50;
export const SEARCH_SNIPPET_CHARS = 300;
const SEARCH_MATCH_THRESHOLD = 0.25;

/**
 * `match_note_chunks` cannot filter by source, so a source filter is applied
 * after it answers. Ask for more chunks when one is set, or a mirror of a few
 * thousand files crowds every native note out of the candidates. Capped: the
 * text arm still covers whatever the vector arm could not reach.
 */
const FILTERED_CANDIDATE_MULTIPLIER = 4;
const MAX_CHUNK_CANDIDATES = 200;

/** What a `source_app` query parameter asks for, once tidied. */
export type SourceAppFilter =
  | { kind: "all" }
  | { kind: "native" }
  | { kind: "exact"; value: string };

/**
 * `source_app=godspeed` means the mirror, `source_app=native` means everything that
 * is not the mirror, any other value is matched as written. Case and
 * surrounding space are ignored, the way `shouldExtractFacts` ignores them.
 */
export function parseSourceAppFilter(raw: string | null | undefined): SourceAppFilter {
  const value = (raw ?? "").trim().toLowerCase();
  if (!value || value === "all") return { kind: "all" };
  if (value === "native") return { kind: "native" };
  return { kind: "exact", value };
}

export function sourceAppMatches(sourceApp: string | null | undefined, filter: SourceAppFilter): boolean {
  if (filter.kind === "all") return true;
  if (filter.kind === "native") return !isGodspeedMirror(sourceApp);
  return (sourceApp ?? "").trim().toLowerCase() === filter.value;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function queryTerms(query: string): string[] {
  return query.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((t) => t.length >= 3);
}

/** First position of the whole query, else of its earliest meaningful term. */
function findHit(text: string, query: string): { index: number; length: number } | null {
  if (!text) return null;
  const q = query.trim();
  if (q) {
    const idx = text.toLowerCase().indexOf(q.toLowerCase());
    if (idx >= 0) return { index: idx, length: q.length };
  }
  let best: { index: number; length: number } | null = null;
  for (const term of queryTerms(query)) {
    const m = new RegExp(escapeRegex(term), "iu").exec(text);
    if (m && (best === null || m.index < best.index)) best = { index: m.index, length: m[0].length };
  }
  return best;
}

function windowAround(text: string, index: number, length: number, size: number): string {
  const radius = Math.max(0, Math.floor((size - length) / 2));
  const start = Math.max(0, index - radius);
  const end = Math.min(text.length, index + length + radius);
  const slice = text.slice(start, end).replace(/\s+/g, " ").trim();
  return `${start > 0 ? "…" : ""}${slice}${end < text.length ? "…" : ""}`;
}

/**
 * About `size` characters around the best hit. The literal query in the body
 * wins, because that is the passage the caller asked for by name; failing that
 * the best-matching chunk, which is why the note was found at all; failing that
 * the opening of the note.
 */
export function buildSearchSnippet(
  note: { content?: string | null; chunk?: string | null },
  query: string,
  size = SEARCH_SNIPPET_CHARS,
): string {
  const content = String(note.content ?? "");
  const chunk = String(note.chunk ?? "");
  const q = query.trim();

  if (q) {
    const idx = content.toLowerCase().indexOf(q.toLowerCase());
    if (idx >= 0) return windowAround(content, idx, q.length, size);
  }
  if (chunk) {
    const hit = findHit(chunk, query);
    return hit ? windowAround(chunk, hit.index, hit.length, size) : windowAround(chunk, 0, 0, size * 2);
  }
  const hit = findHit(content, query);
  return hit ? windowAround(content, hit.index, hit.length, size) : windowAround(content, 0, 0, size * 2);
}

export interface CombinedSearchOptions {
  userId: string;
  query: string;
  /** Straight from a query string is fine: anything unusable becomes the default. */
  limit?: number | string | null;
  sourceApp?: string | null;
  /**
   * Returns the query embedding, metered against `userId`. May throw for any
   * reason (INSUFFICIENT_CREDITS included); a throw means text-only, never an
   * error for the caller.
   */
  embed: (query: string) => Promise<number[]>;
}

export interface CombinedSearchResult {
  id: string;
  title: string | null;
  folder_path: string;
  source_app: string | null;
  source_id: string | null;
  updated_at: string | null;
  similarity: number | null;
  snippet: string;
  // Kept from the ILIKE-only search this replaced, for callers written against it.
  content: string;
  tags: string[];
  entity_type: string | null;
  is_favorite: boolean;
  is_pinned: boolean;
  created_at: string | null;
}

export type CombinedSearchMode = "semantic+text" | "text_only";

const NOTE_FIELDS =
  "id, title, content, tags, entity_type, is_favorite, is_pinned, folder_path, source_app, source_id, created_at, updated_at";

export function clampSearchLimit(raw: unknown): number {
  const n = typeof raw === "number" ? raw : parseInt(String(raw ?? ""), 10);
  if (!Number.isFinite(n)) return SEARCH_DEFAULT_LIMIT;
  return Math.min(Math.max(Math.trunc(n), 1), SEARCH_MAX_LIMIT);
}

function applySourceFilter(query: DbClient, filter: SourceAppFilter) {
  // A coarse filter so the row limit is spent on rows that can qualify.
  // sourceAppMatches() below is the authority; this only narrows the fetch.
  if (filter.kind === "native") return query.or("source_app.is.null,source_app.not.ilike.godspeed");
  if (filter.kind === "exact") return query.ilike("source_app", filter.value);
  return query;
}

/** A note row as both arms fetch it, plus what the merge adds. */
interface SearchRow {
  id: string;
  title: string | null;
  content: string | null;
  tags: string[] | null;
  entity_type: string | null;
  is_favorite: boolean | null;
  is_pinned: boolean | null;
  folder_path: string | null;
  source_app: string | null;
  source_id: string | null;
  created_at: string | null;
  updated_at: string | null;
  similarity: number | null;
  chunk: string | null;
  exact_phrase_match?: boolean;
}

export async function combinedNoteSearch(
  db: DbClient,
  opts: CombinedSearchOptions,
): Promise<{ results: CombinedSearchResult[]; mode: CombinedSearchMode }> {
  const query = opts.query.trim();
  const limit = clampSearchLimit(opts.limit);
  const filter = parseSourceAppFilter(opts.sourceApp);

  const byNote = new Map<string, SearchRow>();
  let semanticOk = false;

  // ---- vector arm --------------------------------------------------------
  try {
    const embedding = await opts.embed(query);
    const wanted = Math.max(limit * 3, 30) * (filter.kind === "all" ? 1 : FILTERED_CANDIDATE_MULTIPLIER);
    const { data, error } = await db.rpc("match_note_chunks", {
      query_embedding: embedding,
      match_threshold: SEARCH_MATCH_THRESHOLD,
      match_count: Math.min(wanted, MAX_CHUNK_CANDIDATES),
      p_user_id: opts.userId,
    });
    if (error) throw new Error(error.message);

    // Best chunk per note.
    const best = new Map<string, { similarity: number; chunk: string }>();
    for (const c of (data || []) as { note_id: string; similarity: number; content: string | null }[]) {
      const ex = best.get(c.note_id);
      if (!ex || c.similarity > ex.similarity) {
        best.set(c.note_id, { similarity: c.similarity, chunk: String(c.content || "") });
      }
    }

    if (best.size > 0) {
      // The RPC is SECURITY DEFINER and already scoped to the user, but the
      // hydration repeats both conditions: this client is the service role,
      // and nothing else here stands between a note id and its body.
      const { data: rows, error: rowsErr } = await db
        .from("notes")
        .select(NOTE_FIELDS)
        .eq("user_id", opts.userId)
        .eq("is_trashed", false)
        .in("id", Array.from(best.keys()));
      if (rowsErr) throw new Error(rowsErr.message);
      for (const r of (rows || []) as SearchRow[]) {
        if (!sourceAppMatches(r.source_app, filter)) continue;
        const hit = best.get(r.id)!;
        byNote.set(r.id, { ...r, similarity: hit.similarity, chunk: hit.chunk });
      }
    }
    semanticOk = true;
  } catch (err) {
    console.warn("combined search: vector arm skipped, text only:", (err as Error)?.message ?? err);
  }

  // ---- text arm ----------------------------------------------------------
  // Inside .or() PostgREST wants the value free of its own delimiters;
  // ilikeAnyColumn quotes it, so the user's text goes in as typed.
  let textQuery = db
    .from("notes")
    .select(NOTE_FIELDS)
    .eq("user_id", opts.userId)
    .eq("is_trashed", false)
    .or(ilikeAnyColumn(["title", "content"], query.toLowerCase()));
  textQuery = applySourceFilter(textQuery, filter);
  const { data: textRows, error: textErr } = await textQuery
    .order("updated_at", { ascending: false })
    .limit(SEARCH_MAX_LIMIT);
  // With both arms down there is nothing to degrade to, and saying "no results"
  // would be a lie about the user's notes.
  if (textErr && !semanticOk) throw new Error(textErr.message);

  for (const r of (textRows || []) as SearchRow[]) {
    if (!sourceAppMatches(r.source_app, filter)) continue;
    const ex = byNote.get(r.id);
    if (ex) ex.exact_phrase_match = true;
    else byNote.set(r.id, { ...r, similarity: null, chunk: null, exact_phrase_match: true });
  }

  const ranked = rankHybridRows(Array.from(byNote.values()), query).slice(0, limit);

  return {
    mode: semanticOk ? "semantic+text" : "text_only",
    results: ranked.map((r) => ({
      id: r.id,
      title: r.title ?? null,
      folder_path: r.folder_path ?? "",
      source_app: r.source_app ?? null,
      source_id: r.source_id ?? null,
      updated_at: r.updated_at ?? null,
      similarity: r.similarity ?? null,
      snippet: buildSearchSnippet({ content: r.content, chunk: r.chunk }, query),
      content: r.content ?? "",
      tags: Array.isArray(r.tags) ? r.tags : [],
      entity_type: r.entity_type ?? null,
      is_favorite: !!r.is_favorite,
      is_pinned: !!r.is_pinned,
      created_at: r.created_at ?? null,
    })),
  };
}
