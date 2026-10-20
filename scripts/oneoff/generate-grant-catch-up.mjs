#!/usr/bin/env node
/**
 * Write the catch-up migration that restates the LIVE privileges of anon,
 * authenticated and service_role on every table, view and sequence in public
 * (2026-10-20, ahead of Supabase dropping its auto-grant defaults on
 * 2026-10-30).
 *
 * Input: a JSON snapshot from the live database, the result of
 *   select json_build_object(
 *     'rels', (select json_agg(json_build_object('name',c.relname,'kind',c.relkind,'acl',c.relacl::text) order by c.relname)
 *              from pg_class c where c.relnamespace='public'::regnamespace and c.relkind in ('r','v','m','p','S','f')),
 *     'cols', (select json_agg(json_build_object('rel',c.relname,'col',a.attname,'acl',a.attacl::text) order by c.relname,a.attname)
 *              from pg_attribute a join pg_class c on c.oid=a.attrelid
 *              where c.relnamespace='public'::regnamespace and a.attacl is not null and not a.attisdropped)
 *   ) as snapshot;
 * saved as the Management API returns it ([{"snapshot": {...}}]).
 *
 * For every object and role it grants exactly what live has and revokes,
 * by name, every privilege live lacks. That makes a rebuild from migrations
 * match live whether the rebuild still auto-grants (old defaults) or grants
 * nothing (new defaults), and makes applying it to live a no-op: live's
 * grants all have grantor postgres, so re-granting one changes nothing, and
 * revoking an absent privilege changes nothing. Column grants come last,
 * because a table-level REVOKE also clears that privilege on every column.
 * MAINTAIN exists from Postgres 17 on, so it sits behind a version check.
 * Objects that no migration creates (live-only) are guarded with to_regclass.
 *
 * Usage: node scripts/oneoff/generate-grant-catch-up.mjs <snapshot.json> <out.sql> <live-only names> <migration-only names>
 * (names comma separated). A migration-only object (created by a migration,
 * dropped live by hand) gets a guarded revoke of everything, live's nearest state.
 */
import { readFileSync, writeFileSync } from "node:fs";

const ROLES = ["anon", "authenticated", "service_role"];
const TABLE_PRIVS = { a: "insert", r: "select", w: "update", d: "delete", D: "truncate", x: "references", t: "trigger" };
const SEQ_PRIVS = { r: "select", w: "update", U: "usage" };

const [snapFile, outFile, liveOnlyArg = "", migrationOnlyArg = ""] = process.argv.slice(2);
const migrationOnly = migrationOnlyArg.split(",").filter(Boolean);
const liveOnly = new Set(liveOnlyArg.split(",").filter(Boolean));
const snap = JSON.parse(readFileSync(snapFile, "utf8"))[0].snapshot;

/** "{postgres=arwd/postgres,anon=r/postgres}" -> Map(role -> letters) */
function parseAcl(text) {
  const map = new Map();
  if (!text) return map;
  for (const item of text.replace(/^\{|\}$/g, "").split(",")) {
    const m = item.match(/^"?([^=]*)=([^/]*)\/(.*?)"?$/);
    if (!m) throw new Error(`cannot read ACL item ${item}`);
    if (m[2].includes("*")) throw new Error(`grant option in ${item}: not handled`);
    if (m[3] !== "postgres") throw new Error(`grantor ${m[3]} in ${item}: re-granting as postgres would add an entry`);
    map.set(m[1], (map.get(m[1]) ?? "") + m[2]);
  }
  return map;
}

const ident = (n) => (/^[a-z_][a-z0-9_]*$/.test(n) ? n : `"${n.replace(/"/g, '""')}"`);

const lines = [];
const maintain = [];
const guarded = [];
for (const rel of snap.rels) {
  const seq = rel.kind === "S";
  const privs = seq ? SEQ_PRIVS : TABLE_PRIVS;
  const on = `${seq ? "sequence" : "table"} public.${ident(rel.name)}`;
  if (rel.acl === null) throw new Error(`${rel.name} has a default (NULL) ACL: not handled`);
  const acl = parseAcl(rel.acl);
  const out = [];
  // Group roles with the same privilege set into one statement.
  const byGrant = new Map();
  const byRevoke = new Map();
  for (const role of ROLES) {
    const letters = acl.get(role) ?? "";
    const has = Object.keys(privs).filter((l) => letters.includes(l)).map((l) => privs[l]);
    const lacks = Object.keys(privs).filter((l) => !letters.includes(l)).map((l) => privs[l]);
    if (has.length) byGrant.set(has.join(", "), [...(byGrant.get(has.join(", ")) ?? []), role]);
    if (lacks.length) byRevoke.set(lacks.join(", "), [...(byRevoke.get(lacks.join(", ")) ?? []), role]);
    if (!seq) maintain.push(`${letters.includes("m") ? "grant" : "revoke"} maintain on ${on} ${letters.includes("m") ? "to" : "from"} ${role}`);
  }
  for (const [p, roles] of byRevoke) out.push(`revoke ${p} on ${on} from ${roles.join(", ")};`);
  for (const [p, roles] of byGrant) out.push(`grant ${p} on ${on} to ${roles.join(", ")};`);
  if (liveOnly.has(rel.name)) guarded.push({ name: rel.name, out });
  else lines.push(...out);
}

// Column grants, after every table-level revoke.
const cols = [];
for (const c of snap.cols ?? []) {
  for (const [role, letters] of parseAcl(c.acl)) {
    if (!ROLES.includes(role)) continue;
    for (const l of letters) {
      const p = TABLE_PRIVS[l];
      if (!p) throw new Error(`column privilege ${l} on ${c.rel}.${c.col}`);
      cols.push({ rel: c.rel, role, p, col: c.col });
    }
  }
}
const colGroups = new Map();
for (const c of cols) {
  const k = `${c.rel}|${c.role}|${c.p}`;
  colGroups.set(k, [...(colGroups.get(k) ?? []), c.col]);
}
const colLines = [...colGroups].map(([k, names]) => {
  const [rel, role, p] = k.split("|");
  return `grant ${p} (${names.map(ident).join(", ")}) on table public.${ident(rel)} to ${role};`;
});

const sql = `-- Catch-up: restate the live privileges of anon, authenticated and
-- service_role on every table, view and sequence in public.
--
-- Supabase stops auto-granting new public tables on 2026-10-30
-- (https://supabase.com/changelog/45329). The live tables keep their grants,
-- but ${snap.rels.length} objects were granted only by those defaults, so a rebuild from
-- migrations (supabase db reset/start with CLI >= 2.106, a preview branch, a
-- disaster-recovery rebuild) would leave them answering "permission denied".
-- This file is generated from the live ACLs of 2026-10-20 by
-- scripts/oneoff/generate-grant-catch-up.mjs and restates them exactly:
-- every privilege live has is granted, every privilege live lacks is revoked,
-- including the tables that are private on purpose. Applied to live it
-- changes nothing (all live grants have grantor postgres). Other roles
-- (powersync_role and the like) are left alone.
${migrationOnly.map((n) => `-- table-grants: ${n}  (dropped live; revoked below when it exists)
`).join("")}
${lines.join("\n")}

-- Objects that no migration in this repository creates (made live by hand),
-- and objects a migration creates that live has since dropped.
do $$
begin
${guarded
  .map(
    (g) =>
      `  if to_regclass('public.${ident(g.name)}') is not null then\n${g.out.map((s) => `    execute ${quote(s.replace(/;$/, ""))};`).join("\n")}\n  end if;`,
  )
  .join("\n")}
end
$$;

-- MAINTAIN exists from Postgres 17 on.
do $$
begin
  if current_setting('server_version_num')::int >= 170000 then
${maintain
  .filter((s) => ![...guarded].some((g) => s.includes(` public.${ident(g.name)} `)))
  .map((s) => `    execute ${quote(s)};`)
  .join("\n")}
${guarded
  .map(
    (g) =>
      `    if to_regclass('public.${ident(g.name)}') is not null then\n${maintain
        .filter((s) => s.includes(` public.${ident(g.name)} `))
        .map((s) => `      execute ${quote(s)};`)
        .join("\n")}\n    end if;`,
  )
  .join("\n")}
  end if;
end
$$;

-- Column grants last: a table-level revoke above also clears that privilege
-- on every column.
${colLines.join("\n")}
`;

function quote(s) {
  return `'${s.replace(/'/g, "''")}'`;
}

writeFileSync(outFile, sql.replace(/\r/g, ""));
console.log(`wrote ${outFile}: ${lines.length + guarded.reduce((n, g) => n + g.out.length, 0)} table/sequence statements, ${maintain.length} maintain, ${colLines.length} column grants`);
