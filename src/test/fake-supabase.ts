/**
 * A recording stand-in for the supabase-js query builder, for hook tests.
 * Every `from(table)` chain is recorded as { table, op, payload, filters },
 * and resolves to whatever `respond` returns for it (default: no rows, no
 * error). `functions.invoke` is recorded the same way.
 */
export interface RecordedQuery {
  table: string;
  op: "select" | "insert" | "update" | "upsert" | "delete";
  payload?: unknown;
  options?: unknown;
  columns?: string;
  filters: Array<[string, string, unknown]>;
  returning?: string;
}

export type Responder = (q: RecordedQuery) => { data?: unknown; error?: unknown } | undefined;

export function createFakeSupabase(respond: Responder = () => undefined) {
  const queries: RecordedQuery[] = [];
  const invocations: Array<{ name: string; body: any }> = [];
  let invokeResult: (name: string, body: any) => Promise<{ data: any; error: any }> = async () => ({
    data: { ok: true, facts: [] },
    error: null,
  });

  const builder = (table: string) => {
    const q: RecordedQuery = { table, op: "select", filters: [] };
    let recorded = false;
    const record = () => {
      if (!recorded) {
        queries.push(q);
        recorded = true;
      }
    };
    const result = () => {
      record();
      const r = respond(q) ?? {};
      return { data: r.data ?? (q.op === "select" || q.returning ? [] : null), error: r.error ?? null };
    };
    const chain: any = {
      select(columns?: string) {
        if (q.op === "select") q.columns = columns;
        else q.returning = columns ?? "*";
        return chain;
      },
      insert(payload: unknown) {
        q.op = "insert";
        q.payload = payload;
        return chain;
      },
      update(payload: unknown) {
        q.op = "update";
        q.payload = payload;
        return chain;
      },
      upsert(payload: unknown, options?: unknown) {
        q.op = "upsert";
        q.payload = payload;
        q.options = options;
        return chain;
      },
      delete() {
        q.op = "delete";
        return chain;
      },
      maybeSingle() {
        return chain;
      },
      single() {
        return chain;
      },
      then(resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) {
        return Promise.resolve(result()).then(resolve, reject);
      },
    };
    for (const op of ["eq", "is", "in", "neq", "like", "ilike", "contains", "order", "limit", "range", "or"]) {
      chain[op] = (column: string, value?: unknown) => {
        q.filters.push([op, column, value]);
        return chain;
      };
    }
    return chain;
  };

  const client = {
    from: (table: string) => builder(table),
    rpc: async () => ({ data: null, error: null }),
    functions: {
      invoke: async (name: string, options: { body?: any } = {}) => {
        invocations.push({ name, body: options.body });
        return invokeResult(name, options.body);
      },
    },
  };

  return {
    client,
    queries,
    invocations,
    setInvokeResult(fn: typeof invokeResult) {
      invokeResult = fn;
    },
    /** Recorded queries on one table, optionally one operation. */
    on(table: string, op?: RecordedQuery["op"]) {
      return queries.filter((q) => q.table === table && (!op || q.op === op));
    },
    reset() {
      queries.length = 0;
      invocations.length = 0;
    },
  };
}

export function filterValue(q: RecordedQuery, op: string, column: string): unknown {
  return q.filters.find(([o, c]) => o === op && c === column)?.[2];
}
