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
