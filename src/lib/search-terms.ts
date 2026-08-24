/**
 * Query term extraction for keyword search.
 *
 * A sentence question like "how does Nadia want to hear bad news" must never
 * perform worse than the key noun inside it. Substring search on the whole
 * sentence finds nothing, so we also search the meaningful terms and rank the
 * union: exact phrase first, then notes matching the most terms.
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

/**
 * Meaningful search terms inside a query. Stopwords and 1-2 character tokens are
 * dropped; capitalised words (likely names) are always kept even if short.
 */
export function extractSearchTerms(query: string): string[] {
  const raw = query.match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) ?? [];
  const seen = new Set<string>();
  const terms: { term: string; index: number; isName: boolean }[] = [];

  raw.forEach((token, index) => {
    const lower = token.toLowerCase();
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


export interface RankableNote {
  title?: string | null;
  content?: string | null;
  updated_at?: string | null;
}

/** Normalize text for comparison: diacritics stripped, whitespace collapsed, lowercased. */
export function normalizeForMatch(s: string | null | undefined): string {
  return (s || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/** Number of query terms present in a note's title or content. */
export function countTermMatches<T extends RankableNote>(note: T, terms: string[]): number {
  const haystack = `${note.title ?? ""}\n${note.content ?? ""}`.toLowerCase();
  return terms.reduce((n, t) => (haystack.includes(t) ? n + 1 : n), 0);
}

function wordBoundaryHit(haystack: string, needle: string): boolean {
  if (!needle) return false;
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|\\W)${escaped}`).test(haystack);
}

/**
 * Tier of a note against the query. Lower is better; a title match always beats
 * a body match, no matter how recent the body match is.
 *
 * 0 title equals the query
 * 1 title contains the whole query phrase
 * 2 title starts with the query, or every term hits a word boundary in the title
 * 3 title contains every term
 * 4 title contains some terms
 * 5 body-only match
 */
export function matchTier<T extends RankableNote>(
  note: T,
  phrase: string,
  terms: string[],
): { tier: number; titleTerms: number; matches: number; phraseHit: boolean } {
  const q = normalizeForMatch(phrase);
  const title = normalizeForMatch(note.title);
  const body = `${note.title ?? ""}\n${note.content ?? ""}`.toLowerCase();
  const phraseHit = q.length > 0 && (title.includes(q) || body.includes(q));
  const matches = countTermMatches(note, terms);
  const titleTerms = terms.reduce((n, t) => (title.includes(t) ? n + 1 : n), 0);

  let tier = 5;
  if (q.length > 0 && title === q) tier = 0;
  else if (q.length > 0 && title.includes(q)) tier = 1;
  else if (q.length > 0 && title.startsWith(q)) tier = 2;
  else if (terms.length > 0 && terms.every((t) => wordBoundaryHit(title, t))) tier = 2;
  else if (terms.length > 0 && titleTerms === terms.length) tier = 3;
  else if (titleTerms > 0) tier = 4;

  return { tier, titleTerms, matches, phraseHit };
}

/** True when the note matched on its title rather than only in its body. */
export function isTitleHit<T extends RankableNote>(
  note: T,
  phrase: string,
  terms: string[],
): boolean {
  return matchTier(note, phrase, terms).tier <= 3;
}

/**
 * Rank keyword hits title-first: exact title, title phrase, title terms, then
 * body matches. Recency only breaks ties inside a tier. Notes matching nothing
 * are dropped.
 */
export function rankNotesByTerms<T extends RankableNote>(
  notes: T[],
  phrase: string,
  terms: string[],
): T[] {
  const scored = notes.map((note, index) => ({
    note,
    index,
    updated: note.updated_at ?? "",
    ...matchTier(note, phrase, terms),
  }));

  return scored
    .filter((s) => s.phraseHit || s.matches > 0 || terms.length === 0)
    .sort((a, b) => {
      if (a.tier !== b.tier) return a.tier - b.tier;
      if (a.titleTerms !== b.titleTerms) return b.titleTerms - a.titleTerms;
      if (a.phraseHit !== b.phraseHit) return a.phraseHit ? -1 : 1;
      if (a.matches !== b.matches) return b.matches - a.matches;
      if (a.updated !== b.updated) return a.updated < b.updated ? 1 : -1;
      return a.index - b.index;
    })
    .map((s) => s.note);
}

