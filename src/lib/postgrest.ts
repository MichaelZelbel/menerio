/**
 * Helpers for safely embedding user input into PostgREST filters.
 *
 * Two distinct hazards:
 *  1. LIKE/ILIKE wildcards — `%` and `_` in user text are pattern metacharacters.
 *     escapeLike() makes them match literally (PostgreSQL uses `\` as the LIKE
 *     escape char by default).
 *  2. The `.or()` / `.and()` filter *grammar* — `,` separates conditions and
 *     `(` `)` group them, so a value containing those breaks parsing (or worse,
 *     silently changes the query). pgOrValue() double-quotes the value so those
 *     characters are treated literally.
 *
 * The two compose correctly for an ILIKE inside an `.or()`: escapeLike() first
 * (adds `\` before wildcards), then pgOrValue() quotes and escapes the `\`
 * again — PostgREST unquotes one layer, then LIKE consumes the other.
 */

/** Escape LIKE/ILIKE wildcards so user input matches literally within a pattern. */
export function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/**
 * Quote a value for safe embedding inside a PostgREST `.or()`/`.and()` filter
 * string. Wrapping in double quotes lets the value contain `,` `.` `:` `(` `)`
 * and spaces; internal backslashes and double quotes are escaped.
 */
export function pgOrValue(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

/** Build a safe `column.ilike.<quoted>` fragment matching text that CONTAINS `q`. */
export function ilikeContains(column: string, q: string): string {
  return `${column}.ilike.${pgOrValue(`%${escapeLike(q)}%`)}`;
}

/** PostgREST's default max-rows. An unpaged select silently stops here. */
export const POSTGREST_PAGE_SIZE = 1000;

/**
 * Read every row of a query, one `.range()` page at a time.
 *
 * `page(from, to)` must build a fresh query with a TOTAL order (end with a
 * unique column such as `id`), or rows can repeat or vanish between pages.
 * `maxRows` is a runaway guard, not a display limit.
 */
export async function fetchAllPages<T>(
  page: (from: number, to: number) => PromiseLike<{ data: unknown; error: unknown }>,
  { pageSize = POSTGREST_PAGE_SIZE, maxRows = 200_000 }: { pageSize?: number; maxRows?: number } = {},
): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; from < maxRows; from += pageSize) {
    const { data, error } = await page(from, from + pageSize - 1);
    if (error) throw error;
    const chunk = (data as T[] | null) ?? [];
    rows.push(...chunk);
    if (chunk.length < pageSize) break;
  }
  return rows;
}
