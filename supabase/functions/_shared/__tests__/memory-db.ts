/**
 * A small in-memory stand-in for the supabase-js client, for tests that need
 * the filters to be EVALUATED rather than ignored: a query that forgets its
 * user or trash condition then shows up as a foreign or trashed row in the
 * result, instead of passing because the fake returned a canned list.
 *
 * Covers only what the note filing, wikilink and folder code uses. Not a test
 * file itself (no `.test.` in the name), so Vitest does not collect it.
 */
// The one loose type in the test fakes; every other file borrows it.
export type Row = Record<string, any>;
type Answer = { data: unknown; error: Row | null };

/** SQL LIKE pattern (with `\` escapes) to a case-insensitive RegExp. */
function likeToRegex(pattern: string): RegExp {
  let out = "";
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i];
    if (ch === "\\" && i + 1 < pattern.length) { out += pattern[++i].replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); continue; }
    if (ch === "%") { out += ".*"; continue; }
    if (ch === "_") { out += "."; continue; }
    out += ch.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${out}$`, "is");
}

export interface MemoryDb {
  tables: Record<string, Row[]>;
  rpcCalls: { name: string; args: Row }[];
  rpc: (name: string, args: Row) => Promise<Answer>;
  from: (table: string) => Row;
}

export function memoryDb(
  tables: Record<string, Row[]>,
  rpcs: Record<string, (args: Row, db: MemoryDb) => Answer> = {},
  uniqueKeys: Record<string, string[]> = {},
): MemoryDb {
  let seq = 0;
  const db: MemoryDb = {
    tables,
    rpcCalls: [],
    async rpc(name, args) {
      db.rpcCalls.push({ name, args });
      const fn = rpcs[name];
      return fn ? fn(args, db) : { data: null, error: { message: `unexpected rpc ${name}` } };
    },
    from(table: string) {
      if (!tables[table]) tables[table] = [];
      const filters: ((r: Row) => boolean)[] = [];
      let action: "select" | "insert" | "update" | "upsert" | "delete" = "select";
      let payload: Row[] = [];
      let patch: Row = {};
      let upsertOpts: { onConflict?: string; ignoreDuplicates?: boolean } = {};
      let one: "single" | "maybe" | null = null;
      const orderBy: { col: string; asc: boolean }[] = [];
      let window: [number, number] | null = null;
      let max: number | null = null;

      const q: Row = {
        select: () => q,
        insert: (v: Row | Row[]) => { action = "insert"; payload = Array.isArray(v) ? v : [v]; return q; },
        upsert: (v: Row | Row[], o: typeof upsertOpts = {}) => { action = "upsert"; payload = Array.isArray(v) ? v : [v]; upsertOpts = o; return q; },
        update: (v: Row) => { action = "update"; patch = v; return q; },
        delete: () => { action = "delete"; return q; },
        eq: (k: string, v: unknown) => { filters.push((r) => r[k] === v); return q; },
        neq: (k: string, v: unknown) => { filters.push((r) => r[k] !== v); return q; },
        in: (k: string, vs: unknown[]) => { filters.push((r) => vs.includes(r[k])); return q; },
        ilike: (k: string, p: string) => { const re = likeToRegex(p); filters.push((r) => re.test(String(r[k] ?? ""))); return q; },
        not: (k: string, op: string, p: string) => {
          if (op !== "ilike") throw new Error(`memoryDb: not.${op} is not modelled`);
          const re = likeToRegex(p); filters.push((r) => !re.test(String(r[k] ?? ""))); return q;
        },
        order: (col: string, o: { ascending?: boolean } = {}) => { orderBy.push({ col, asc: o.ascending !== false }); return q; },
        limit: (n: number) => { max = n; return q; },
        range: (from: number, to: number) => { window = [from, to]; return q; },
        single: () => { one = "single"; return q; },
        maybeSingle: () => { one = "maybe"; return q; },
        then: (ok: (v: unknown) => unknown, fail?: (e: unknown) => unknown) =>
          Promise.resolve().then(() => {
            const match = (r: Row) => filters.every((f) => f(r));
            let rows: Row[];
            if (action === "insert" || action === "upsert") {
              rows = [];
              const keys = upsertOpts.onConflict?.split(",").map((k) => k.trim()) ?? uniqueKeys[table];
              for (const p of payload) {
                const clash = keys && tables[table].find((r) => keys.every((k) => r[k] === p[k]));
                if (clash && action === "insert") return { data: null, error: { code: "23505", message: `duplicate key in ${table}` } };
                if (clash) { if (!upsertOpts.ignoreDuplicates) Object.assign(clash, p); continue; }
                const row = { id: p.id ?? `${table}-${++seq}`, created_at: `2026-09-20T00:00:${String(seq).padStart(2, "0")}Z`, ...p };
                tables[table].push(row);
                rows.push(row);
              }
            } else if (action === "update") {
              rows = tables[table].filter(match);
              rows.forEach((r) => Object.assign(r, patch));
            } else if (action === "delete") {
              rows = tables[table].filter(match);
              tables[table] = tables[table].filter((r) => !rows.includes(r));
            } else {
              rows = tables[table].filter(match);
            }
            for (const { col, asc } of [...orderBy].reverse()) {
              rows = [...rows].sort((a, b) => String(a[col] ?? "").localeCompare(String(b[col] ?? "")) * (asc ? 1 : -1));
            }
            if (window) rows = rows.slice(window[0], window[1] + 1);
            if (max != null) rows = rows.slice(0, max);
            if (one) {
              if (one === "single" && rows.length !== 1) return { data: null, error: { message: "expected exactly one row" } };
              return { data: rows[0] ?? null, error: null };
            }
            return { data: rows, error: null };
          }).then(ok, fail),
      };
      return q;
    },
  };
  return db;
}
