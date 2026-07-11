/**
 * Pure logic backing ProfileFieldFilter: which entries match a live filter
 * query, and how to split label/value text into highlight-ready segments.
 * Kept dependency-free (no React, no supabase) so it's trivially unit
 * testable and reusable from any renderer.
 */

export interface FilterableEntry {
  id: string;
  label: string;
  value: string;
}

export interface FieldMatch {
  matchedLabel: boolean;
  matchedValue: boolean;
}

/**
 * Matches entries against `query` case-insensitively on label and/or value.
 *
 * - Empty (or whitespace-only) query: every entry is returned as a match —
 *   callers should treat filtering as "inactive" in that case (gate on
 *   `query.trim().length > 0`, not on map membership) and use this map only
 *   for its (empty) matched-field flags.
 * - Non-empty query: only entries whose label and/or value contains the
 *   query are present in the returned map, each flagged with which field(s)
 *   matched.
 */
export function filterEntries(
  entries: FilterableEntry[],
  query: string,
): Map<string, FieldMatch> {
  const trimmed = query.trim().toLowerCase();
  const result = new Map<string, FieldMatch>();

  if (!trimmed) {
    for (const entry of entries) {
      result.set(entry.id, { matchedLabel: false, matchedValue: false });
    }
    return result;
  }

  for (const entry of entries) {
    const matchedLabel = entry.label.toLowerCase().includes(trimmed);
    const matchedValue = entry.value.toLowerCase().includes(trimmed);
    if (matchedLabel || matchedValue) {
      result.set(entry.id, { matchedLabel, matchedValue });
    }
  }

  return result;
}

export interface TextSegment {
  text: string;
  matched: boolean;
}

/**
 * Splits `text` into segments around case-insensitive occurrences of
 * `query`, for `<mark>`-wrapping matched substrings. Returns the whole text
 * as a single unmatched segment when the query is empty or not found.
 */
export function highlightSegments(text: string, query: string): TextSegment[] {
  const trimmed = query.trim();
  if (!trimmed) return [{ text, matched: false }];

  const lowerText = text.toLowerCase();
  const lowerQuery = trimmed.toLowerCase();

  const firstIndex = lowerText.indexOf(lowerQuery);
  if (firstIndex === -1) return [{ text, matched: false }];

  const segments: TextSegment[] = [];
  let cursor = 0;
  let idx = firstIndex;
  while (idx !== -1) {
    if (idx > cursor) segments.push({ text: text.slice(cursor, idx), matched: false });
    segments.push({ text: text.slice(idx, idx + trimmed.length), matched: true });
    cursor = idx + trimmed.length;
    idx = lowerText.indexOf(lowerQuery, cursor);
  }
  if (cursor < text.length) segments.push({ text: text.slice(cursor), matched: false });

  return segments;
}
