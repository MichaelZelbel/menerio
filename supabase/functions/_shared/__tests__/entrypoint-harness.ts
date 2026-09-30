/**
 * Run a deployed edge function (its real index.ts, bundled) against an
 * in-memory database whose filters are EVALUATED, so a write that forgets its
 * owner, trash or visibility condition shows up as a changed row.
 *
 * Only the database client, the network and the few Deno globals the
 * functions touch are synthetic. Not a test file itself (no `.test.` in the
 * name), so Vitest does not collect it.
 */
import { build, type Plugin } from "esbuild";
import vm from "node:vm";
import { webcrypto } from "node:crypto";

// deno-lint-ignore no-explicit-any
export type Row = Record<string, any>;
type Answer = { data: unknown; error: Row | null; count?: number | null };

export interface FakeUser {
  id: string;
  email?: string;
  identities?: { provider: string }[];
  user_metadata?: Row;
}

export interface FakeOptions {
  tables: Record<string, Row[]>;
  rpcs?: Record<string, (args: Row) => Answer>;
  /** Who a session token belongs to; null for "not signed in". */
  user?: FakeUser | null;
  password?: string;
  deleteUserError?: Row | null;
  /** Make a plain select() against this table fail, e.g. a dropped connection. */
  selectErrors?: Record<string, { message: string }>;
}

/** One `or()` condition in PostgREST grammar, the few forms the code uses. */
function orCondition(cond: string): (r: Row) => boolean {
  const m = /^([a-z_]+)\.(not\.)?(is|in|eq)\.(.*)$/.exec(cond.trim());
  if (!m) throw new Error(`fake db: or() condition not modelled: ${cond}`);
  const [, col, not, op, raw] = m;
  let test: (r: Row) => boolean;
  if (op === "is") test = (r) => (r[col] ?? null) === (raw === "null" ? null : raw);
  else if (op === "in") {
    const list = raw.replace(/^\(|\)$/g, "").split(",");
    test = (r) => list.includes(String(r[col]));
  } else test = (r) => String(r[col]) === raw;
  return not ? (r) => !test(r) : test;
}

/** Split an or() argument on top-level commas (not the ones inside `in.(...)`). */
function splitOr(expr: string): string[] {
  const out: string[] = [];
  let depth = 0, start = 0;
  for (let i = 0; i < expr.length; i++) {
    if (expr[i] === "(") depth++;
    else if (expr[i] === ")") depth--;
    else if (expr[i] === "," && depth === 0) { out.push(expr.slice(start, i)); start = i + 1; }
  }
  out.push(expr.slice(start));
  return out;
}

/** PostgREST's `alias:column->key` projection, added to the row; everything else passes whole. */
function project(row: Row, cols: string | undefined): Row {
  if (!cols) return row;
  const out: Row = { ...row };
  for (const part of cols.split(",")) {
    const m = /^\s*([a-z_]+):([a-z_]+)->([a-z_]+)\s*$/.exec(part);
    if (m) out[m[1]] = (row[m[2]] as Row | null | undefined)?.[m[3]] ?? null;
  }
  return out;
}

export function fakeClient(opts: FakeOptions) {
  const { tables } = opts;
  const log: string[] = [];
  let seq = 0;

  function from(table: string) {
    if (!tables[table]) tables[table] = [];
    const filters: ((r: Row) => boolean)[] = [];
    let action: "select" | "insert" | "update" | "upsert" | "delete" = "select";
    let payload: Row[] = [];
    let patch: Row = {};
    let upsertOpts: { onConflict?: string; ignoreDuplicates?: boolean } = {};
    let cols: string | undefined;
    let countWanted = false;
    let head = false;
    let one: "single" | "maybe" | null = null;
    const orderBy: { col: string; asc: boolean }[] = [];
    let window: [number, number] | null = null;
    let max: number | null = null;

    const q: Row = {
      select: (c?: string, o?: { count?: string; head?: boolean }) => {
        cols = c;
        if (o?.count) countWanted = true;
        if (o?.head) head = true;
        return q;
      },
      insert: (v: Row | Row[]) => { action = "insert"; payload = Array.isArray(v) ? v : [v]; return q; },
      upsert: (v: Row | Row[], o: typeof upsertOpts = {}) => { action = "upsert"; payload = Array.isArray(v) ? v : [v]; upsertOpts = o; return q; },
      update: (v: Row) => { action = "update"; patch = v; return q; },
      delete: () => { action = "delete"; return q; },
      eq: (k: string, v: unknown) => { filters.push((r) => r[k] === v); return q; },
      neq: (k: string, v: unknown) => { filters.push((r) => r[k] !== v); return q; },
      is: (k: string, v: unknown) => { filters.push((r) => (r[k] ?? null) === v); return q; },
      in: (k: string, vs: unknown[]) => { filters.push((r) => vs.includes(r[k])); return q; },
      gte: (k: string, v: string) => { filters.push((r) => r[k] >= v); return q; },
      lte: (k: string, v: string) => { filters.push((r) => r[k] <= v); return q; },
      lt: (k: string, v: string) => { filters.push((r) => r[k] < v); return q; },
      contains: (k: string, vs: unknown[]) => { filters.push((r) => Array.isArray(r[k]) && vs.every((x) => r[k].includes(x))); return q; },
      not: (k: string, op: string, v: string) => {
        if (op === "eq" && v === "{}") filters.push((r) => Array.isArray(r[k]) && r[k].length > 0);
        else throw new Error(`fake db: not.${op} is not modelled`);
        return q;
      },
      or: (expr: string) => { const conds = splitOr(expr).map(orCondition); filters.push((r) => conds.some((c) => c(r))); return q; },
      order: (col: string, o: { ascending?: boolean } = {}) => { orderBy.push({ col, asc: o.ascending !== false }); return q; },
      limit: (n: number) => { max = n; return q; },
      range: (a: number, b: number) => { window = [a, b]; return q; },
      single: () => { one = "single"; return q; },
      maybeSingle: () => { one = "maybe"; return q; },
      then: (ok: (v: Answer) => unknown, fail?: (e: unknown) => unknown) =>
        Promise.resolve().then((): Answer => {
          if (action === "select" && opts.selectErrors?.[table]) {
            return { data: null, error: opts.selectErrors[table] };
          }
          const match = (r: Row) => filters.every((f) => f(r));
          let rows: Row[];
          if (action === "insert" || action === "upsert") {
            log.push(`${action} ${table}`);
            rows = [];
            const keys = upsertOpts.onConflict?.split(",").map((k) => k.trim());
            for (const p of payload) {
              const clash = keys && tables[table].find((r) => keys.every((k) => r[k] === p[k]));
              if (clash) { if (!upsertOpts.ignoreDuplicates) Object.assign(clash, p); continue; }
              const row = { id: p.id ?? `${table}-${++seq}`, ...p };
              tables[table].push(row);
              rows.push(row);
            }
          } else if (action === "update") {
            rows = tables[table].filter(match);
            log.push(`update ${table} ${rows.length}`);
            rows.forEach((r) => Object.assign(r, patch));
          } else if (action === "delete") {
            rows = tables[table].filter(match);
            log.push(`delete ${table} ${rows.length}`);
            tables[table] = tables[table].filter((r) => !rows.includes(r));
          } else {
            rows = tables[table].filter(match);
          }
          for (const { col, asc } of [...orderBy].reverse()) {
            rows = [...rows].sort((a, b) => String(a[col] ?? "").localeCompare(String(b[col] ?? "")) * (asc ? 1 : -1));
          }
          const count = countWanted ? rows.length : null;
          if (window) rows = rows.slice(window[0], window[1] + 1);
          if (max != null) rows = rows.slice(0, max);
          rows = rows.map((r) => project(r, cols));
          if (head) return { data: null, error: null, count };
          if (one) {
            if (rows.length > 1 || (one === "single" && rows.length === 0)) {
              return { data: null, error: { code: "PGRST116", message: `expected one row, got ${rows.length}` } };
            }
            return { data: rows[0] ?? null, error: null };
          }
          return { data: rows, error: null, count };
        }).then(ok, fail),
    };
    return q;
  }

  const user = opts.user ?? null;
  const client = {
    from,
    async rpc(name: string, args: Row): Promise<Answer> {
      log.push(`rpc ${name}`);
      const fn = opts.rpcs?.[name];
      return fn ? fn(args) : { data: null, error: { message: `unexpected rpc ${name}` } };
    },
    auth: {
      getUser: async () => (user ? { data: { user }, error: null } : { data: { user: null }, error: { message: "invalid token" } }),
      getClaims: async () => (user ? { data: { claims: { sub: user.id } }, error: null } : { data: null, error: { message: "invalid token" } }),
      signInWithPassword: async ({ password }: { password: string }) =>
        (password === opts.password ? { data: {}, error: null } : { data: {}, error: { message: "Invalid login credentials" } }),
      admin: {
        deleteUser: async (id: string) => {
          log.push(`auth.deleteUser ${id}`);
          if (opts.deleteUserError) return { error: opts.deleteUserError };
          // The cascade: every row that names this user goes with it.
          for (const name of Object.keys(tables)) {
            tables[name] = tables[name].filter((r) => r.user_id !== id && !(name === "profiles" && r.id === id));
          }
          return { error: null };
        },
        getUserById: async (id: string) => ({ data: { user: { id, email: `${id}@example.test` } }, error: null }),
      },
    },
    storage: {
      from: (bucket: string) => ({
        list: async () => { log.push(`storage.list ${bucket}`); return { data: [], error: null }; },
        remove: async () => ({ error: null }),
      }),
    },
  };
  return { client, log, tables };
}

/**
 * Bundle `supabase/functions/<name>/index.ts` and return its request handler.
 * `stubs` replaces a module (matched on its import path) with the given source.
 */
export async function loadFunction(
  name: string,
  client: unknown,
  env: Record<string, string>,
  options: { fetch?: (url: string, init?: RequestInit) => Promise<Response>; stubs?: { filter: RegExp; contents: string }[]; globals?: Row } = {},
): Promise<(req: Request) => Promise<Response>> {
  const fakes: Plugin = {
    name: "synthetic-platform",
    setup(b) {
      b.onResolve({ filter: /^(https:\/\/esm\.sh\/@supabase\/|npm:@supabase\/)/ }, (args) => ({ path: args.path, namespace: "fake-supabase" }));
      // Real @supabase/supabase-js throws "supabaseKey is required." when the
      // key argument is missing; reproduce that one check so a function that
      // reads an env var the hosted runtime never sets (and so calls
      // createClient(url, undefined)) fails here exactly as it does in
      // production, instead of silently getting the fake client anyway.
      b.onLoad({ filter: /.*/, namespace: "fake-supabase" }, () => ({
        contents: "export const createClient = (url, key) => { if (!key) throw new Error('supabaseKey is required.'); return globalThis.testClient; }",
        loader: "js",
      }));
      b.onResolve({ filter: /^https:\/\/deno\.land\/std@[^/]+\/http\/server\.ts$/ }, (args) => ({ path: args.path, namespace: "fake-std" }));
      b.onLoad({ filter: /.*/, namespace: "fake-std" }, () => ({ contents: "export const serve = (fn) => globalThis.Deno.serve(fn)", loader: "js" }));
      (options.stubs ?? []).forEach((stub, i) => {
        b.onResolve({ filter: stub.filter }, (args) => ({ path: args.path, namespace: `fake-stub-${i}` }));
        b.onLoad({ filter: /.*/, namespace: `fake-stub-${i}` }, () => ({ contents: stub.contents, loader: "js" }));
      });
    },
  };
  const bundle = await build({
    entryPoints: [`supabase/functions/${name}/index.ts`], bundle: true, write: false, platform: "node", format: "cjs", plugins: [fakes],
  });
  let handler: ((req: Request) => Promise<Response>) | undefined;
  const quiet = { ...console, log: () => {}, warn: () => {}, error: () => {} };
  vm.runInNewContext(bundle.outputFiles[0].text, {
    testClient: client, console: quiet,
    Request, Response, URL, Headers, AbortSignal, TextEncoder, TextDecoder, crypto: webcrypto, setTimeout, clearTimeout,
    fetch: options.fetch ?? (async () => new Response("{}")),
    Deno: { env: { get: (key: string) => env[key] }, serve: (fn: (req: Request) => Promise<Response>) => { handler = fn; } },
    ...options.globals,
  });
  if (!handler) throw new Error(`${name} never called Deno.serve`);
  return handler;
}
