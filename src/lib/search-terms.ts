/**
 * Keyword relevance for note search.
 *
 * One scoring function is shared by every search surface (header search, the
 * Notes page, `[[` autocomplete, the note picker, the command palette) so the
 * surfaces can never drift apart.
 *
 * The scorer is COVERAGE-AWARE: how much of the *title* the query accounts for
 * matters more than anything else. Typing "ownward s" must surface the note
 * titled `Ownward Studio` above eight freshly edited journal entries whose long
 * headlines merely contain the same phrase. Recency is only a final tie-break
 * and can never overturn a coverage or position difference.
 */

const STOPWORDS = new Set([
  "a", "about", "after", "all", "am", "an", "and", "any", "are", "as", "at", "be", "because",
  "been", "before", "being", "but", "by", "can", "could", "did", "do", "does", "doing", "done",
  "for", "from", "get", "gets", "had", "has", "have", "he", "her", "here", "hers", "him", "his",
  "how", "i", "if", "in", "into", "is", "it", "its", "just", "like", "me", "my", "no", "not",
  "of", "on", "one", "or", "our", "out", "over", "own", "same", "she", "should", "so", "some",
  "such", "than", "that", "the", "their", "them", "then", "there", "these", "they", "this",
  "those", "to", "too", "under", "up", "very", "want", "wants", "was", "we", "were", "what",
  "when", "where", "which", "while", "who", "whom", "why", "will", "with", "would", "you",
  "your", "yours",
]);

const MAX_TERMS = 6;

/** Normalize text for comparison: diacritics stripped, whitespace collapsed, lowercased. */
export function normalizeForMatch(s: string | null | undefined): string {
  return (s || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function tokenize(query: string): string[] {
  return (normalizeForMatch(query).match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) ?? []);
}

/**
 * Meaningful search terms inside a query. Stopwords and 1-2 character tokens are
 * dropped; capitalised words (likely names) are always kept even if short.
 */
export function extractSearchTerms(query: string): string[] {
  const rawTokens = query.match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) ?? [];
  const seen = new Set<string>();
  const terms: { term: string; index: number; isName: boolean }[] = [];

  rawTokens.forEach((token, index) => {
    const lower = normalizeForMatch(token);
    // A capitalised word that isn't the first word and isn't a stopword looks
    // like a proper noun ("Nadia") — those are the highest-signal terms.
    const isName = index > 0 && /^\p{Lu}/u.test(token) && !STOPWORDS.has(lower);
    if (!isName && STOPWORDS.has(lower)) return;
    if (!isName && lower.length < 3) return;
    if (seen.has(lower)) return;
    seen.add(lower);
    terms.push({ term: lower, index, isName });
  });

  // Keep proper nouns first when we have to trim, but restore reading order.
  return terms
    .slice()
    .sort((a, b) => (a.isName === b.isName ? a.index - b.index : a.isName ? -1 : 1))
    .slice(0, MAX_TERMS)
    .sort((a, b) => a.index - b.index)
    .map((t) => t.term);
}

/**
 * The trailing token of a query someone is still typing ("ownward s" → "s").
 * It is a prefix, not a whole word, so it is excluded from `extractSearchTerms`
 * (a bare "s" would match everything) but IS useful for the title probe that
 * guarantees the exactly-titled note is in the candidate set.
 */
export function trailingPrefix(query: string): string {
  if (/\s$/.test(query)) return "";
  const tokens = tokenize(query);
  const last = tokens[tokens.length - 1] ?? "";
  return last.length > 0 && last.length < 3 ? last : "";
}

export interface RankableNote {
  title?: string | null;
  content?: string | null;
  updated_at?: string | null;
}

/** Number of query terms present in a note's title or content. */
export function countTermMatches<T extends RankableNote>(note: T, terms: string[]): number {
  const haystack = `${normalizeForMatch(note.title)}\n${normalizeForMatch(note.content)}`;
  return terms.reduce((n, t) => (haystack.includes(t) ? n + 1 : n), 0);
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Index of the first occurrence of `needle` at a word boundary, or -1. */
function wordStartIndex(haystack: string, needle: string): number {
  if (!needle) return -1;
  const m = new RegExp(`(^|[^\\p{L}\\p{N}])(${escapeRe(needle)})`, "u").exec(haystack);
  return m ? m.index + m[1].length : -1;
}

/** Bounded Levenshtein distance; returns `max + 1` as soon as it exceeds `max`. */
export function boundedLevenshtein(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const curr = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      const v = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
      curr.push(v);
      if (v < rowMin) rowMin = v;
    }
    if (rowMin > max) return max + 1;
    prev = curr;
  }
  return prev[b.length];
}

/** How many edits a term of this length may be off by. 0 disables fuzzy matching. */
function fuzzyBudget(term: string): number {
  if (term.length >= 8) return 2;
  if (term.length >= 5) return 1;
  return 0;
}

function fuzzyTermHit(titleTokens: string[], term: string): boolean {
  const budget = fuzzyBudget(term);
  if (budget === 0) return false;
  return titleTokens.some((tok) => boundedLevenshtein(tok, term, budget) <= budget);
}

/** Score bands. Any title match outranks any body-only match. */
const BAND = {
  titleFloor: 150,
  bodyCeiling: 149,
} as const;

export interface NoteScore {
  /** Total relevance; 0 means "no match at all, drop it". */
  score: number;
  /** True when the note matched on its title rather than only in its body. */
  titleHit: boolean;
}

/**
 * Relevance of one note against a query.
 *
 * Title matches are scored by *what fraction of the title the query covers* and
 * *where* the match starts, so a short, precise title always beats a long
 * sentence headline that happens to contain the same words.
 */
export function scoreNote<T extends RankableNote>(
  note: T,
  phrase: string,
  terms: string[],
  options: { fuzzy?: boolean } = {},
): NoteScore {
  const q = normalizeForMatch(phrase);
  const title = normalizeForMatch(note.title);
  const content = normalizeForMatch(note.content);
  const haystack = `${title}\n${content}`;

  if (!q && terms.length === 0) return { score: 0, titleHit: false };

  // --- Title scoring -------------------------------------------------------
  const titleLen = Math.max(title.length, 1);
  let titleScore = 0;

  if (q) {
    const coverage = Math.min(q.length / titleLen, 1); // 0..1
    if (title === q) {
      titleScore = 1000;
    } else {
      const idx = title.indexOf(q);
      if (idx === 0) {
        titleScore = 800 + coverage * 150;
      } else if (idx > 0) {
        const wordStart = wordStartIndex(title, q);
        const base = wordStart >= 0 ? 620 : 480;
        const pos = wordStart >= 0 ? wordStart : idx;
        // Later in the title = weaker signal, but capped so coverage still leads.
        titleScore = base + coverage * 150 - Math.min(pos, 120) * 0.25;
      }
    }
  }

  if (titleScore === 0 && terms.length > 0) {
    const inTitle = terms.filter((t) => title.includes(t));
    const atWordStart = terms.filter((t) => wordStartIndex(title, t) >= 0);
    if (inTitle.length > 0) {
      const frac = inTitle.length / terms.length;
      const matchedChars = inTitle.reduce((n, t) => n + t.length, 0);
      const coverage = Math.min(matchedChars / titleLen, 1);
      const firstPos = Math.min(
        ...inTitle.map((t) => {
          const w = wordStartIndex(title, t);
          return w >= 0 ? w : title.indexOf(t);
        }),
      );
      const allWordStart = atWordStart.length === terms.length;
      const base = frac === 1 ? (allWordStart ? 460 : 380) : 200 + frac * 120;
      titleScore = base + coverage * 150 - Math.min(firstPos, 120) * 0.25;
    }
  }

  if (titleScore === 0 && options.fuzzy) {
    const titleTokens = tokenize(title);
    const hits = terms.filter((t) => fuzzyTermHit(titleTokens, t));
    if (hits.length > 0) {
      const frac = hits.length / terms.length;
      const matchedChars = hits.reduce((n, t) => n + t.length, 0);
      const coverage = Math.min(matchedChars / titleLen, 1);
      titleScore = BAND.titleFloor + frac * 120 + coverage * 100;
    }
  }

  if (titleScore > 0) {
    // Body agreement is a small bonus, never enough to reorder title bands.
    const bodyTerms = terms.filter((t) => content.includes(t)).length;
    return { score: titleScore + Math.min(bodyTerms, 5) * 2, titleHit: true };
  }

  // --- Body-only scoring ---------------------------------------------------
  let bodyScore = 0;
  if (q && haystack.includes(q)) bodyScore = 100;
  const bodyTermHits = terms.filter((t) => content.includes(t)).length;
  if (bodyTermHits > 0) {
    bodyScore = Math.max(bodyScore, 20 + (bodyTermHits / Math.max(terms.length, 1)) * 60);
  }
  return { score: Math.min(bodyScore, BAND.bodyCeiling), titleHit: false };
}

/** True when the note matched on its title rather than only in its body. */
export function isTitleHit<T extends RankableNote>(
  note: T,
  phrase: string,
  terms: string[],
): boolean {
  return scoreNote(note, phrase, terms).titleHit;
}

/**
 * Rank keyword hits by relevance. Notes matching nothing are dropped.
 *
 * A bounded typo-tolerant pass runs only when the strict pass produced no title
 * match at all, so fuzzy hits can never dilute exact results.
 */
export function rankNotesByTerms<T extends RankableNote>(
  notes: T[],
  phrase: string,
  terms: string[],
): T[] {
  const strict = notes.map((note, index) => ({
    note,
    index,
    updated: note.updated_at ?? "",
    ...scoreNote(note, phrase, terms),
  }));

  const noTitleHit = !strict.some((s) => s.titleHit);
  const scored = noTitleHit
    ? notes.map((note, index) => ({
        note,
        index,
        updated: note.updated_at ?? "",
        ...scoreNote(note, phrase, terms, { fuzzy: true }),
      }))
    : strict;

  return scored
    .filter((s) => s.score > 0 || (!phrase.trim() && terms.length === 0))
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      if (a.updated !== b.updated) return a.updated < b.updated ? 1 : -1;
      return a.index - b.index;
    })
    .map((s) => s.note);
}
