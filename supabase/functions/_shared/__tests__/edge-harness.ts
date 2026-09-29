/**
 * Test harness for running a real edge function entrypoint (`<fn>/index.ts`)
 * under the Node test runner, with every import replaced by a fixture.
 *
 * Not a test file itself (no `.test.ts`), so vitest only runs it through the
 * tests that import it. Nothing here reaches a network, a database or a provider.
 */
import { readFileSync } from "node:fs";
import ts from "typescript";

export type Handler = (req: Request) => Promise<Response>;

/** Transpile and execute an entrypoint; returns the request handler it registered. */
export function loadEndpoint(
  path: string,
  modules: Record<string, unknown>,
  env: Record<string, string>,
  edgeRuntime: { waitUntil: (p: Promise<unknown>) => void } = { waitUntil: () => {} },
): Handler {
  let handler: Handler | null = null;
  const register = (fn: Handler) => { handler = fn; };
  const allModules: Record<string, unknown> = {
    "https://deno.land/std@0.224.0/http/server.ts": { serve: register },
    "jsr:@supabase/functions-js/edge-runtime.d.ts": {},
    ...modules,
  };
  const source = readFileSync(path, "utf8");
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  new Function("require", "Deno", "EdgeRuntime", "exports", output)(
    (name: string) => {
      if (!(name in allModules)) throw new Error(`Unexpected import ${name}`);
      return allModules[name];
    },
    { env: { get: (name: string) => env[name] }, serve: register },
    edgeRuntime,
    {},
  );
  if (!handler) throw new Error(`${path} registered no handler`);
  return handler;
}

export interface QueryLog {
  table: string;
  /** Every builder call in order, e.g. ["eq", "user_id", "u"]. */
  ops: unknown[][];
  /** True when the chain called the method at least once with these leading args. */
  has(method: string, ...args: unknown[]): boolean;
}

type Result = { data?: unknown; error?: unknown; count?: number };

/**
 * A PostgREST-shaped client whose every chain method returns itself and whose
 * result is decided per table by `respond`, after the whole chain is known.
 */
export function fakeDb(respond: (q: QueryLog) => Result = () => ({ data: null, error: null })) {
  const queries: QueryLog[] = [];
  const from = (table: string) => {
    const log: QueryLog = {
      table,
      ops: [],
      has: (method, ...args) =>
        log.ops.some((op) => op[0] === method && args.every((a, i) => JSON.stringify(op[i + 1]) === JSON.stringify(a))),
    };
    queries.push(log);
    const settle = () => {
      const r = respond(log);
      return { data: r.data ?? null, error: r.error ?? null, count: r.count };
    };
    const builder: any = new Proxy({}, {
      get(_t, key) {
        if (key === "then") return (res: any, rej: any) => Promise.resolve(settle()).then(res, rej);
        // Like the real PostgREST builder: thenable, but no .catch or .finally.
        if (key === "catch" || key === "finally") return undefined;
        return (...args: unknown[]) => {
          log.ops.push([key, ...args]);
          if (key === "single" || key === "maybeSingle") return Promise.resolve(settle());
          return builder;
        };
      },
    });
    return builder;
  };
  const rpcCalls: { name: string; args: unknown }[] = [];
  return {
    client: {
      from,
      rpc: async (name: string, args: unknown) => { rpcCalls.push({ name, args }); return { data: null, error: null }; },
      auth: { getUser: async () => ({ data: { user: { id: "user-a" } }, error: null }) },
    },
    queries,
    rpcCalls,
    /** Queries against one table, in order. */
    on: (table: string) => queries.filter((q) => q.table === table),
  };
}

export function postJson(url: string, body: unknown, token = "user-token"): Request {
  return new Request(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}
