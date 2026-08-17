/**
 * Read every row a query matches, not the first page of them.
 *
 * PostgREST caps an unbounded select (Supabase defaults to 1000 rows) and says
 * nothing about it, so `.select(...)` with no `.range()` quietly means "up to
 * 1000". Code that then counts the result, diffs it against another set, or
 * deduplicates it into a work list is wrong the moment the table outgrows the
 * cap — and wrong in the quiet direction, because a short list looks exactly
 * like a complete answer.
 *
 * Pass a builder that applies `.range(from, to)` to an otherwise-complete
 * query. Give the query a stable `.order(...)`, or paging can skip and repeat
 * rows between pages.
 */
export async function selectAllRows<T>(
  buildQuery: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>,
  pageSize = 1000,
): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await buildQuery(from, from + pageSize - 1);
    if (error) throw error;
    const rows = data ?? [];
    out.push(...rows);
    if (rows.length < pageSize) return out;
  }
}
