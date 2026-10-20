#!/usr/bin/env node
/**
 * Fail when a migration creates a table, view or materialized view in the
 * public schema without saying, in the same file, who may use it.
 *
 * Why: on 2026-10-30 Supabase revokes its old default privileges on every
 * project (https://supabase.com/changelog/45329). From then on a table created
 * in public gets NO grant for anon, authenticated or service_role, so
 * supabase-js, PostgREST and every edge function using the service_role key
 * get "permission denied" on it. The same happens to every table when the
 * database is rebuilt from migrations (supabase db reset / start with CLI
 * >= 2.106, preview branches, a disaster-recovery rebuild).
 *
 * Rules, per file:
 *  - every `CREATE [OR REPLACE] [UNLOGGED] TABLE | VIEW | MATERIALIZED VIEW`
 *    in public (unqualified names count as public) needs either
 *      GRANT ... ON [TABLE] [public.]x[, ...] TO ...      (who may use it), or
 *      REVOKE ... ON [TABLE] [public.]x[, ...] FROM ...   (a deliberate private table)
 *    `ON ALL TABLES IN SCHEMA public` covers every table in the file.
 *  - a table with a serial/bigserial/smallserial column whose INSERT (or ALL)
 *    is granted to anon or authenticated also needs
 *      GRANT USAGE[, SELECT] ON SEQUENCE [public.]x_col_seq TO ...
 *    (or ON ALL SEQUENCES IN SCHEMA public). Identity columns need none.
 *  - SQL built with format()/EXECUTE is invisible to this text check: name the
 *    table in a comment `-- table-grants: x` once the dynamic grant is written.
 *
 * Only migrations with version >= ENFORCE_FROM are enforced; older ones were
 * created under the auto-grant defaults and are live already. For the rebuild
 * case the script also REPORTS (never fails on) older objects that no
 * migration ever grants or revokes.
 *
 * Usage:
 *   node scripts/check-table-grants.mjs              check supabase/migrations
 *   node scripts/check-table-grants.mjs a.sql b.sql  enforce on these files whatever their name
 */
import { readdirSync, readFileSync, realpathSync } from "node:fs";
import { basename, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const ENFORCE_FROM = "20261020000000";

const IDENT = String.raw`(?:"[^"]+"|[A-Za-z_][\w$]*)`;
const QNAME = String.raw`${IDENT}(?:\s*\.\s*${IDENT})?`;

/** Lower-cased, unquoted, with the schema split off ("" when unqualified). */
function splitName(raw) {
  const parts = raw.split(/\s*\.\s*/).map((p) => (p.startsWith('"') ? p.slice(1, -1) : p.toLowerCase()));
  return parts.length === 2 ? { schema: parts[0], name: parts[1] } : { schema: "", name: parts[0] };
}

const isPublic = (schema) => schema === "" || schema === "public";

/** Remove comments and the bodies of string literals, keep the markers. */
export function stripSql(sql) {
  const markers = [...sql.matchAll(/--\s*table-grants:\s*([^\n]+)/gi)].flatMap((m) =>
    m[1].split(/[\s,]+/).filter(Boolean).map((n) => splitName(n.trim()).name),
  );
  const code = sql
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/--[^\n]*/g, " ")
    .replace(/'(?:[^']|'')*'/g, "''");
  return { code, markers };
}

/** Text between the parenthesis at `open` and its partner. */
function parenBody(code, open) {
  let depth = 0;
  for (let i = open; i < code.length; i++) {
    if (code[i] === "(") depth++;
    else if (code[i] === ")" && --depth === 0) return code.slice(open + 1, i);
  }
  return code.slice(open + 1);
}

const CREATE_RE = new RegExp(
  String.raw`\bCREATE\s+(?:OR\s+REPLACE\s+)?(?:(TEMP|TEMPORARY)\s+|UNLOGGED\s+)?(TABLE|MATERIALIZED\s+VIEW|VIEW)\s+(?:IF\s+NOT\s+EXISTS\s+)?(${QNAME})`,
  "gi",
);
const PRIV_RE = new RegExp(
  String.raw`\b(GRANT|REVOKE)\s+((?:(?!\bON\b)[^;])*?)\bON\s+(?:(ALL\s+TABLES|ALL\s+SEQUENCES)\s+IN\s+SCHEMA\s+(${IDENT})|(TABLE\s+|SEQUENCE\s+)?(${QNAME}(?:\s*,\s*${QNAME})*))\s+(TO|FROM)\s+([^;]*)`,
  "gi",
);
const SERIAL_RE = /(?:^|,)\s*("[^"]+"|[A-Za-z_][\w$]*)\s+(?:small|big)?serial[248]?\b/gi;

/** Every table/view the file creates in public, with its serial columns. */
export function createdObjects(code) {
  const out = [];
  for (const m of code.matchAll(CREATE_RE)) {
    if (m[1]) continue; // temporary
    const { schema, name } = splitName(m[3]);
    if (!isPublic(schema)) continue;
    const kind = m[2].toUpperCase().replace(/\s+/g, " ");
    const serials = [];
    if (kind === "TABLE") {
      const rest = code.slice(m.index + m[0].length);
      const open = rest.search(/\S/);
      if (rest[open] === "(") {
        for (const s of parenBody(rest, open).matchAll(SERIAL_RE)) serials.push(splitName(s[1]).name);
      }
    }
    out.push({ kind: kind.toLowerCase(), name, serials });
  }
  return out;
}

/** Grants and revokes on tables and sequences in the file. */
export function privileges(code) {
  const tables = new Map(); // name -> { grants: [{privs, roles}], revoked: bool }
  const sequences = new Set();
  let allTables = false;
  let allSequences = false;
  const entry = (n) => tables.get(n) ?? tables.set(n, { grants: [], revoked: false }).get(n);
  for (const m of code.matchAll(PRIV_RE)) {
    const verb = m[1].toUpperCase();
    const privs = m[2].toUpperCase();
    const roles = m[8].toLowerCase().split(/[\s,]+/).filter(Boolean);
    if (m[3]) {
      if (!isPublic(splitName(m[4]).name)) continue;
      if (/TABLES/i.test(m[3])) allTables = true;
      else if (verb === "GRANT") allSequences = true;
      continue;
    }
    if (/^EXECUTE\b|\bFUNCTION\b/.test(privs)) continue;
    const targets = m[6].split(/\s*,\s*/).map(splitName).filter((t) => isPublic(t.schema));
    for (const { name } of targets) {
      if (/SEQUENCE/i.test(m[5] ?? "")) {
        if (verb === "GRANT") sequences.add(name);
        continue;
      }
      const e = entry(name);
      if (verb === "GRANT") e.grants.push({ privs, roles });
      else e.revoked = true;
    }
  }
  return { tables, sequences, allTables, allSequences };
}

/** Problems with one file's SQL, as strings. Empty means fine. */
export function checkSql(sql) {
  const { code, markers } = stripSql(sql);
  const objects = createdObjects(code);
  const p = privileges(code);
  const problems = [];
  for (const o of objects) {
    const t = p.tables.get(o.name);
    const covered = p.allTables || markers.includes(o.name) || (t && (t.grants.length > 0 || t.revoked));
    if (!covered) {
      problems.push(`${o.kind} public.${o.name} has no GRANT (or deliberate REVOKE) in this migration`);
      continue;
    }
    if (!o.serials.length || p.allSequences || markers.includes(o.name)) continue;
    const writesFromClient = (t?.grants ?? []).some(
      (g) => g.roles.some((r) => r === "anon" || r === "authenticated") && /\b(ALL|INSERT)\b/.test(g.privs),
    );
    if (!writesFromClient) continue;
    for (const col of o.serials) {
      const seq = `${o.name}_${col}_seq`;
      if (!p.sequences.has(seq)) {
        problems.push(`table public.${o.name} lets anon/authenticated insert but sequence public.${seq} (serial column ${col}) has no GRANT USAGE`);
      }
    }
  }
  return problems;
}

const versionOf = (file) => (basename(file).match(/^(\d{14})/) ?? [])[1] ?? "";

/**
 * files: [{ name, sql }] in migration order. Returns enforced failures, plus
 * a report on older migrations for the rebuild-from-migrations case.
 */
export function checkMigrations(files, enforceFrom = ENFORCE_FROM) {
  const failures = [];
  const olderFiles = [];
  for (const f of files) {
    const problems = checkSql(f.sql);
    if (!problems.length) continue;
    if (versionOf(f.name) >= enforceFrom) failures.push(...problems.map((m) => `${f.name}: ${m}`));
    else olderFiles.push(f.name);
  }
  // Older objects that no migration anywhere grants, revokes or drops.
  const created = new Map();
  const handled = new Set();
  let everythingGranted = false;
  for (const f of files) {
    const { code, markers } = stripSql(f.sql);
    for (const o of createdObjects(code)) if (!created.has(o.name)) created.set(o.name, f.name);
    const p = privileges(code);
    if (p.allTables) everythingGranted = true;
    for (const [n, t] of p.tables) if (t.grants.length || t.revoked) handled.add(n);
    markers.forEach((n) => handled.add(n));
    for (const d of code.matchAll(new RegExp(String.raw`\bDROP\s+(?:TABLE|VIEW|MATERIALIZED\s+VIEW)\s+(?:IF\s+EXISTS\s+)?(${QNAME}(?:\s*,\s*${QNAME})*)`, "gi"))) {
      d[1].split(/\s*,\s*/).forEach((n) => created.delete(splitName(n).name));
    }
  }
  const neverGranted = everythingGranted
    ? []
    : [...created].filter(([n, file]) => versionOf(file) < enforceFrom && !handled.has(n)).map(([n]) => n).sort();
  return { failures, olderFiles, neverGranted };
}

function main() {
  const args = process.argv.slice(2);
  if (args.length) {
    // Explicit files (for example before a hand-applied production script):
    // enforced whatever their name.
    const failures = args.flatMap((file) => checkSql(readFileSync(file, "utf8")).map((m) => `${file}: ${m}`));
    if (failures.length) {
      console.error(explain(failures));
      process.exit(1);
    }
    console.log(`table grants: ok (${args.length} file(s))`);
    return;
  }
  const dir = fileURLToPath(new URL("../supabase/migrations/", import.meta.url));
  const files = readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((name) => ({ name, sql: readFileSync(join(dir, name), "utf8") }));
  const { failures, olderFiles, neverGranted } = checkMigrations(files);
  if (failures.length) {
    console.error(explain(failures));
    process.exit(1);
  }
  console.log(
    `table grants: ok (${files.length} migrations, enforced from ${ENFORCE_FROM}). ` +
      `Report only: ${olderFiles.length} older migrations create a public table/view without a grant in the same file; ` +
      `${neverGranted.length} public tables/views from older migrations are granted by no migration at all, so a rebuild from migrations would leave them without access` +
      (neverGranted.length ? `: ${neverGranted.join(", ")}` : "."),
  );
}

function explain(failures) {
  return (
    "Tables without explicit grants (Supabase stopped auto-granting new public tables on 2026-10-30):\n  " +
    failures.join("\n  ") +
    "\n\nAdd to the same migration, keeping only the roles that should have access:\n" +
    "  grant select on public.x to anon;  -- only if anonymous visitors should read it\n" +
    "  grant select, insert, update, delete on public.x to authenticated;\n" +
    "  grant select, insert, update, delete on public.x to service_role;\n" +
    "or, for a deliberately private table, an explicit revoke ... on public.x from anon, authenticated;"
  );
}

function isMainModule() {
  if (!process.argv[1]) return false;
  try {
    const invoked = pathToFileURL(realpathSync(process.argv[1])).href;
    return process.platform === "win32" ? invoked.toLowerCase() === import.meta.url.toLowerCase() : invoked === import.meta.url;
  } catch {
    return false;
  }
}

if (isMainModule()) main();
