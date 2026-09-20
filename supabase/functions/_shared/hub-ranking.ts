/**
 * One policy for how a mirrored hub file ranks against a note the user wrote.
 *
 * The hub mirror is thousands of machine-maintained Markdown files sitting in
 * the same table as the user's own notes. They are worth finding, which is why
 * they are embedded at all, but they are not what the user means by "my notes":
 * asked about a person or a decision, the note the user wrote should come before
 * the file an assistant generated about it. Without a rule the mirror wins on sheer
 * volume, because it has more text about everything.
 *
 * Every surface that ranks notes applies the numbers below, so a note cannot
 * be first in one search and buried in another:
 *   - MCP `search_notes` / `search_brain` (hybridSearchNotes)
 *   - `search-notes-semantic` (the app's semantic search)
 *   - `hub-api-notes` GET /search
 *   - the app's keyword scorer, through the twin in `src/lib/hub-ranking.ts`
 *     (the frontend build cannot import from this tree; a test holds the two
 *     files to the same numbers)
 *
 * Demoted, never hidden: a caller that wants the mirror asks for it by source.
 *
 * Pure on purpose: no Deno APIs in this file, so the Node test runner can
 * import it directly.
 */
import { isHubMirror } from "./hub-source.ts";

/** A hub file's similarity is multiplied by this before anything is ordered. */
export const HUB_SIMILARITY_FACTOR = 0.85;

/** Where ranking is tiered, a hub file lands this many tiers below its match. */
export const HUB_TIER_DEMOTION = 1;

/** The folder tree the mirror owns. Nothing else may be filed in or under it. */
export const HUB_FOLDER_ROOT = "hub";

export type NoteSourceFilter = "all" | "native" | "hub";

/**
 * The similarity to ORDER by. The raw figure is still what gets shown: it is a
 * measurement, and printing a discounted one would be a number nobody computed.
 */
export function rankingSimilarity(
  similarity: number | null | undefined,
  sourceApp?: string | null,
): number | null {
  if (similarity == null || !Number.isFinite(similarity)) return null;
  return isHubMirror(sourceApp) ? similarity * HUB_SIMILARITY_FACTOR : similarity;
}

/** The tier a row sorts in, given the tier its match earned (lower is better). */
export function demoteTier(tier: number, sourceApp?: string | null): number {
  return isHubMirror(sourceApp) ? tier + HUB_TIER_DEMOTION : tier;
}

/** Sort comparator half: native notes before hub files, otherwise no opinion. */
export function compareNativeFirst(
  aSourceApp?: string | null,
  bSourceApp?: string | null,
): number {
  return Number(isHubMirror(aSourceApp)) - Number(isHubMirror(bSourceApp));
}

export function matchesSourceFilter(
  sourceApp: string | null | undefined,
  filter: NoteSourceFilter | null | undefined,
): boolean {
  if (filter === "native") return !isHubMirror(sourceApp);
  if (filter === "hub") return isHubMirror(sourceApp);
  return true;
}

/**
 * True for the mirror's folder and everything under it. Expects a path that has
 * already been through normalizeFolderPath. Case-insensitive, because the note
 * tree would show "Hub/x" and "hub/x" as two trees that look like one.
 */
export function isHubFolderPath(path: string | null | undefined): boolean {
  const p = (path ?? "").trim().toLowerCase();
  return p === HUB_FOLDER_ROOT || p.startsWith(`${HUB_FOLDER_ROOT}/`);
}

/**
 * The line a search result carries so a model can tell a mirrored file from
 * something the user wrote. Null for a native note, which needs no label.
 */
export function hubFileLabel(
  sourceApp?: string | null,
  sourceId?: string | null,
): string | null {
  if (!isHubMirror(sourceApp)) return null;
  const id = (sourceId ?? "").trim();
  return id ? `[hub file: ${id}]` : "[hub file]";
}

export interface HybridRankable {
  title?: string | null;
  similarity?: number | null;
  exact_phrase_match?: boolean;
  source_app?: string | null;
  updated_at?: string | null;
  created_at?: string | null;
}

/**
 * The tier a hybrid-search row earned from its match alone, before any source
 * demotion. Exact and prefix title matches always win; a bare text hit is last.
 */
export function hybridMatchTier(row: HybridRankable, query: string): number {
  const qn = (query || "").trim().toLowerCase();
  const title = (row.title || "").trim().toLowerCase();
  if (qn && title === qn) return 0;
  if (qn && title.startsWith(qn)) return 1;
  if (qn && title.includes(qn)) return 2;
  if (row.exact_phrase_match) return 3;
  if (row.similarity != null) return 4;
  return 5;
}

/**
 * Deterministic order for merged semantic + text rows: tier (hub demoted),
 * discounted similarity, native before hub on a tie, recency, then the order
 * the rows arrived in so equal rows never swap between calls.
 *
 * Native-first is the TIE-break, not the second key. Almost every question an
 * assistant asks is a sentence, so almost every row lands in the similarity
 * tier; with native-first ahead of similarity a hub file could only ever show
 * after every native hit of that tier, which is hidden, not "less relevant".
 * The demotion and the 0.85 factor are the whole penalty.
 */
export function rankHybridRows<T extends HybridRankable>(rows: T[], query: string): T[] {
  const time = (r: HybridRankable) => new Date(r.updated_at || r.created_at || 0).getTime() || 0;
  return rows
    .map((r, idx) => ({ r, idx, tier: demoteTier(hybridMatchTier(r, query), r.source_app) }))
    .sort((a, b) =>
      a.tier - b.tier ||
      ((rankingSimilarity(b.r.similarity, b.r.source_app) ?? -1) -
        (rankingSimilarity(a.r.similarity, a.r.source_app) ?? -1)) ||
      compareNativeFirst(a.r.source_app, b.r.source_app) ||
      (time(b.r) - time(a.r)) ||
      (a.idx - b.idx)
    )
    .map((x) => x.r);
}
