/**
 * Helpers for safely embedding user input into PostgREST filters.
 *
 * This is the edge-function twin of `src/lib/postgrest.ts`. The two cannot be
 * one file: the frontend builds through Vite with `@/` aliases, and the edge
 * functions are Deno modules resolved by relative URL. Keep them in step — if
 * you change one, change the other and both test files.
 *
 * Two distinct hazards:
 *  1. LIKE/ILIKE wildcards — `%` and `_` in user text are pattern
 *     metacharacters. escapeLike() makes them match literally (PostgreSQL uses
 *     `\` as the LIKE escape character by default).
 *  2. The `.or()` / `.and()` filter *grammar* — `,` separates conditions and
 *     `(` `)` group them, so a value containing those breaks parsing. A search
 *     for "Smith, John" became two conditions and returned a 400.
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

/**
 * Join `ilikeContains` fragments for several columns into one `.or()` argument.
 * The comma here is the filter grammar's separator, which is exactly why the
 * values either side of it have to be quoted first.
 */
export function ilikeAnyColumn(columns: string[], q: string): string {
  return columns.map((c) => ilikeContains(c, q)).join(",");
}
