/**
 * An in-memory stand-in for the supabase-js client for the fact readers and
 * writers, with the two views built from one fixture the way the SQL builds
 * them (docs/plans/one-fact-store.md 3.3): profile_facts is every claim,
 * agent_facts drops private sections and hidden or sensitive subjects.
 *
 * Filters are EVALUATED, so a reader that forgets a filter shows a foreign or
 * hidden row in its output instead of passing. Every query is recorded with
 * its filters, so a test can assert that each service-role read of a user's
 * table carries an explicit user_id filter.
 *
 * Not a test file itself (no `.test.` in the name).
 */
export type Row = Record<string, any>;

export interface QueryLog {
  table: string;
  action: string;
  filters: string[];
}

/** One fact of the fixture: a claim plus what the views join onto it. */
export interface FixtureFact {
  claim_id: string;
  user_id: string;
  subject_type: "self" | "contact" | "entity";
  subject_id: string | null;
  attribute: string;
  value: string;
  label?: string;
  category_slug?: string | null;
  category_name?: string | null;
  visibility_scope?: string;
  valid_from?: string | null;
  valid_to?: string | null;
  is_pinned?: boolean;
  show_to_agent?: boolean;
  has_conflict?: boolean;
  origin?: string;
  rank?: string;
  source_type?: string | null;
  source_id?: string | null;
  evidence_quote?: string | null;
  review_by?: string | null;
  embedding?: unknown;
}

export const TODAY = "2026-09-28";

function viewRow(f: FixtureFact): Row {
  const current = (!f.valid_from || f.valid_from <= TODAY) && (!f.valid_to || f.valid_to > TODAY);
  return {
    claim_id: f.claim_id,
    user_id: f.user_id,
    subject_type: f.subject_type,
    subject_id: f.subject_id,
    contact_id: f.subject_type === "contact" ? f.subject_id : null,
    attribute: f.attribute,
    value: f.value,
    valid_from: f.valid_from ?? null,
    valid_to: f.valid_to ?? null,
    is_current: current,
    confidence: "likely",
    cardinality: "one",
    origin: f.origin ?? "ai_note",
    rank: f.rank ?? "normal",
    evidence_quote: f.evidence_quote ?? null,
    source_type: f.source_type ?? "ai",
    source_id: f.source_id ?? null,
    review_by: f.review_by ?? null,
    created_at: "2026-09-01T00:00:00Z",
    updated_at: "2026-09-01T00:00:00Z",
    slot_id: `slot-${f.claim_id}`,
    label: f.label ?? f.attribute,
    category_slug: f.category_slug ?? null,
    category_name: f.category_name ?? null,
    visibility_scope: f.visibility_scope ?? "all",
    is_pinned: f.is_pinned ?? false,
    show_to_agent: f.show_to_agent ?? false,
    has_conflict: f.has_conflict ?? false,
  };
}

function toClaim(f: FixtureFact): Row {
  return {
    id: f.claim_id,
    user_id: f.user_id,
    subject_type: f.subject_type,
    subject_id: f.subject_id,
    attribute: f.attribute,
    value: f.value,
    valid_from: f.valid_from ?? null,
    valid_to: f.valid_to ?? null,
    rank: f.rank ?? "normal",
    origin: f.origin ?? "ai_note",
    evidence_quote: f.evidence_quote ?? null,
    embedding: f.embedding ?? null,
    created_at: "2026-09-01T00:00:00Z",
  };
}

function parseValue(raw: string): unknown {
  if (raw === "null") return null;
  if (raw === "true") return true;
  if (raw === "false") return false;
  return raw;
}

/** A PostgREST `or` filter of simple `col.op.value` terms (no nesting). */
function orFilter(expr: string): (r: Row) => boolean {
  if (/^and\(/.test(expr)) throw new Error("fact-db: nested or/and is not modelled");
  const terms = expr.split(",").map((t) => {
    const [col, op, ...rest] = t.split(".");
    const val = parseValue(rest.join("."));
    return (r: Row) => {
      const v = r[col] ?? null;
      switch (op) {
        case "is": return v === val;
        case "eq": return v === val;
        case "neq": return v !== val;
        case "gte": return v !== null && String(v) >= String(val);
        case "gt": return v !== null && String(v) > String(val);
        default: throw new Error(`fact-db: or op ${op} is not modelled`);
      }
    };
  });
  return (r) => terms.some((t) => t(r));
}

function likeToRegex(pattern: string): RegExp {
  const esc = pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/%/g, ".*").replace(/_/g, ".");
  return new RegExp(`^${esc}$`, "is");
}

export interface FactDb {
  tables: Record<string, Row[]>;
  log: QueryLog[];
  rpcCalls: string[];
  paused: boolean;
  from: (table: string) => Row;
  rpc: (name: string, args: Row) => Promise<{ data: unknown; error: unknown }>;
}

/**
 * The database. `facts` builds claims and both views; `contacts` and
 * `entities` decide what agent_facts keeps, as the SQL view does.
 */
export function factDb(seed: { facts?: FixtureFact[]; tables?: Record<string, Row[]> }): FactDb {
  const tables: Record<string, Row[]> = { ...(seed.tables ?? {}) };
  tables.contacts ??= [];
  tables.entities ??= [];
  tables.claims ??= (seed.facts ?? []).map(toClaim);
  const facts = seed.facts ?? [];
  let seq = 0;

  const agentVisible = (r: Row) => {
    if (r.visibility_scope === "private") return false;
    if (r.subject_type === "self") return true;
    if (r.subject_type === "contact") {
      return tables.contacts.some((c) => c.id === r.subject_id && c.user_id === r.user_id && !c.merged_into &&
        c.is_sensitive !== true && c.ai_visibility === "visible");
    }
    return tables.entities.some((e) => e.id === r.subject_id && e.user_id === r.user_id &&
      e.ai_visibility === "visible" && e.is_sensitive !== true);
  };
  const views = () => {
    // Claims inserted by a writer during the test join the views too.
    const known = new Set(facts.map((f) => f.claim_id));
    const extra = tables.claims.filter((c) => !known.has(c.id)).map((c) => viewRow({
      claim_id: c.id, user_id: c.user_id, subject_type: c.subject_type, subject_id: c.subject_id,
      attribute: c.attribute, value: c.value, valid_from: c.valid_from, valid_to: c.valid_to,
      origin: c.origin, evidence_quote: c.evidence_quote,
    }));
    const live = facts.filter((f) => tables.claims.some((c) => c.id === f.claim_id)).map((f) => {
      const c = tables.claims.find((x) => x.id === f.claim_id)!;
      return viewRow({ ...f, value: c.value, valid_to: c.valid_to, valid_from: c.valid_from });
    });
    const all = [...live, ...extra];
    return { profile_facts: all, agent_facts: all.filter(agentVisible) };
  };

  const db: FactDb = {
    tables,
    log: [],
    rpcCalls: [],
    paused: false,
    async rpc(name) {
      db.rpcCalls.push(name);
      if (name === "fact_writes_paused") return { data: db.paused, error: null };
      if (name === "fact_today") return { data: TODAY, error: null };
      if (name === "ai_can_see") return { data: true, error: null };
      return { data: null, error: { message: `unexpected rpc ${name}` } };
    },
    from(table: string) {
      const entry: QueryLog = { table, action: "select", filters: [] };
      db.log.push(entry);
      const filters: ((r: Row) => boolean)[] = [];
      let payload: Row[] = [];
      let patch: Row = {};
      let one = false;
      let window: [number, number] | null = null;
      let max: number | null = null;
      const orderBy: { col: string; asc: boolean }[] = [];
      const add = (desc: string, f: (r: Row) => boolean) => { entry.filters.push(desc); filters.push(f); };

      const q: Row = {
        select: () => q,
        insert: (v: Row | Row[]) => { entry.action = "insert"; payload = Array.isArray(v) ? v : [v]; return q; },
        update: (v: Row) => { entry.action = "update"; patch = v; return q; },
        delete: () => { entry.action = "delete"; return q; },
        eq: (k: string, v: unknown) => { add(`eq:${k}`, (r) => r[k] === v); return q; },
        neq: (k: string, v: unknown) => { add(`neq:${k}`, (r) => r[k] !== v); return q; },
        in: (k: string, vs: unknown[]) => { add(`in:${k}`, (r) => vs.includes(r[k])); return q; },
        is: (k: string, v: unknown) => { add(`is:${k}`, (r) => (r[k] ?? null) === v); return q; },
        gte: (k: string, v: string) => { add(`gte:${k}`, (r) => String(r[k] ?? "") >= v); return q; },
        like: (k: string, p: string) => { const re = likeToRegex(p); add(`like:${k}`, (r) => re.test(String(r[k] ?? ""))); return q; },
        ilike: (k: string, p: string) => { const re = likeToRegex(p); add(`ilike:${k}`, (r) => re.test(String(r[k] ?? ""))); return q; },
        or: (expr: string) => { add(`or:${expr}`, orFilter(expr)); return q; },
        not: (k: string, op: string, v: unknown) => {
          if (op !== "is") throw new Error(`fact-db: not.${op} is not modelled`);
          add(`not:${k}`, (r) => (r[k] ?? null) !== v);
          return q;
        },
        order: (col: string, o: { ascending?: boolean } = {}) => { orderBy.push({ col, asc: o.ascending !== false }); return q; },
        limit: (n: number) => { max = n; return q; },
        range: (from: number, to: number) => { window = [from, to]; return q; },
        single: () => { one = true; return q; },
        maybeSingle: () => { one = true; return q; },
        then: (ok: (v: unknown) => unknown, fail?: (e: unknown) => unknown) =>
          Promise.resolve().then(() => {
            const source = table === "profile_facts" || table === "agent_facts" ? views()[table] : (tables[table] ??= []);
            const match = (r: Row) => filters.every((f) => f(r));
            let rows: Row[];
            if (entry.action === "insert") {
              rows = payload.map((p) => ({ id: p.id ?? `${table}-${++seq}`, embedding: null, ...p }));
              if (table === "claims") {
                for (const r of rows) {
                  const clash = tables.claims.find((c) => c.user_id === r.user_id && c.subject_type === r.subject_type &&
                    (c.subject_id ?? null) === (r.subject_id ?? null) && c.attribute === r.attribute &&
                    c.valid_to === null && String(c.value).trim().toLowerCase() === String(r.value).trim().toLowerCase());
                  if (clash && r.valid_to == null) return { data: null, error: { code: "23505", message: "duplicate" } };
                }
              }
              tables[table].push(...rows);
            } else if (entry.action === "update") {
              rows = source.filter(match);
              rows.forEach((r) => Object.assign(r, patch));
            } else if (entry.action === "delete") {
              rows = source.filter(match);
              tables[table] = tables[table].filter((r) => !rows.includes(r));
            } else {
              rows = source.filter(match);
            }
            for (const { col, asc } of [...orderBy].reverse()) {
              rows = [...rows].sort((a, b) => String(a[col] ?? "").localeCompare(String(b[col] ?? "")) * (asc ? 1 : -1));
            }
            if (window) rows = rows.slice(window[0], window[1] + 1);
            if (max != null) rows = rows.slice(0, max);
            if (one) return { data: rows[0] ?? null, error: null };
            return { data: rows, error: null };
          }).then(ok, fail),
      };
      return q;
    },
  };
  return db;
}

/** Tables that hold one user's rows: a service-role read of them must say whose. */
export const USER_TABLES = new Set([
  "agent_facts", "profile_facts", "claims", "fact_slots", "contacts", "entities", "notes",
  "contact_relationships", "ai_suggestion_suppressions", "profile_categories", "agent_instructions",
]);

/** Queries on a user's table without an explicit user_id filter. Inserts carry user_id in the row. */
export function queriesWithoutUser(db: FactDb): QueryLog[] {
  return db.log.filter((q) => USER_TABLES.has(q.table) && q.action !== "insert" && !q.filters.includes("eq:user_id"));
}
