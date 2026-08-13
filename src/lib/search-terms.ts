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

/** Number of query terms present in a note's title or content. */
export function countTermMatches<T extends RankableNote>(note: T, terms: string[]): number {
  const haystack = `${note.title ?? ""}\n${note.content ?? ""}`.toLowerCase();
  return terms.reduce((n, t) => (haystack.includes(t) ? n + 1 : n), 0);
}

/**
 * Rank keyword hits: exact phrase matches first, then by number of matching
 * terms, then by recency. Notes matching no term at all are dropped.
 */
export function rankNotesByTerms<T extends RankableNote>(
  notes: T[],
  phrase: string,
  terms: string[],
): T[] {
  const p = phrase.trim().toLowerCase();
  const scored = notes.map((note, index) => {
    const haystack = `${note.title ?? ""}\n${note.content ?? ""}`.toLowerCase();
    const phraseHit = p.length > 0 && haystack.includes(p);
    const matches = countTermMatches(note, terms);
    return { note, index, phraseHit, matches, updated: note.updated_at ?? "" };
  });

  return scored
    .filter((s) => s.phraseHit || s.matches > 0 || terms.length === 0)
    .sort((a, b) => {
      if (a.phraseHit !== b.phraseHit) return a.phraseHit ? -1 : 1;
      if (a.matches !== b.matches) return b.matches - a.matches;
      if (a.updated !== b.updated) return a.updated < b.updated ? 1 : -1;
      return a.index - b.index;
    })
    .map((s) => s.note);
}
