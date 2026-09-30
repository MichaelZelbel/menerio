#!/usr/bin/env node
/**
 * Fail if any migration leaves an admin able to READ a table outside the
 * allowlist. Replays every CREATE/DROP/ALTER POLICY, DROP TABLE and table
 * RENAME in migration order, then looks at the surviving SELECT/ALL policies
 * that mention is_admin or the 'admin' role. Level 1 privacy (docs/superpowers/
 * plans/2026-09-29-admin-privacy-and-avatar-removal.md): staff get account and
 * billing data, never content. Keep ALLOWED identical to the list in
 * supabase/migrations/20261001100300_remove_admin_content_reads.sql.
 *
 * This is a text replay, not a real Postgres parser: it accepts quoted and
 * unquoted policy names, strips block comments as well as line comments,
 * follows ALTER POLICY (both a RENAME TO and a USING/WITH CHECK change), and
 * carries a table's policy keys across `ALTER TABLE ... RENAME TO ...` (not a
 * column or constraint rename). It cannot see anything built with format() or
 * run conditionally by other means, which is why the migration's own drops
 * must be written out literally.
 */
import { readdirSync, readFileSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// Exposed only so the CLI-detection test can compare against this module's
// own import.meta.url without re-deriving it by hand.
export const MODULE_URL = import.meta.url;

export const ALLOWED = new Set([
  "user_roles", "ai_allowance_periods", "user_suspensions", "llm_usage_events",
  "llm_call_configs", "moderation_stopwords", "moderation_events",
  "moderation_review_queue", "ai_credit_settings",
]);

const norm = (t) => t.replace(/"/g, "").replace(/^public\./i, "");

// Group indices: 1 action, 2 quoted policy name, 3 unquoted policy name,
// 4 policy table, 5 policy body (until `;`), 6 DROP TABLE target,
// 7/8 ALTER TABLE ... RENAME TO ... (old/new table).
const STATEMENT_RE =
  /(CREATE|DROP|ALTER)\s+POLICY\s+(?:IF\s+EXISTS\s+)?(?:"([^"]+)"|(\w+))\s+ON\s+([\w."]+)([\s\S]*?);|DROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?([\w."]+)|ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:ONLY\s+)?([\w."]+)\s+RENAME\s+TO\s+([\w."]+)/gi;

function stripComments(sql) {
  return sql.replace(/\/\*[\s\S]*?\*\//g, "").replace(/--[^\n]*/g, "");
}

function renameTableKeys(state, oldTable, newTable) {
  for (const key of [...state.keys()]) {
    if (key.startsWith(`${oldTable}|`)) {
      const value = state.get(key);
      state.delete(key);
      state.set(`${newTable}|${key.slice(oldTable.length + 1)}`, value);
    }
  }
}

/**
 * Replay CREATE/DROP/ALTER POLICY, DROP TABLE and table renames across
 * `files` (in the order given, which must be migration order) and return the
 * surviving policies as a Map of "table|name" -> { file, body }.
 */
export function replayPolicies(files) {
  const state = new Map();
  for (const { name: file, sql: rawSql } of files) {
    const sql = stripComments(rawSql);
    for (const m of sql.matchAll(STATEMENT_RE)) {
      if (m[7] !== undefined) {
        renameTableKeys(state, norm(m[7]), norm(m[8]));
        continue;
      }
      if (m[6] !== undefined) {
        const t = norm(m[6]);
        for (const k of [...state.keys()]) if (k.startsWith(`${t}|`)) state.delete(k);
        continue;
      }
      const action = m[1].toUpperCase();
      const name = m[2] !== undefined ? m[2] : m[3].toLowerCase();
      const table = norm(m[4]);
      const key = `${table}|${name}`;
      const body = (m[5] ?? "").replace(/\s+/g, " ").trim();
      if (action === "DROP") {
        state.delete(key);
      } else if (action === "CREATE") {
        state.set(key, { file, body });
      } else {
        // ALTER POLICY: either a rename (move the key, body unchanged) or a
        // USING/WITH CHECK change (replace the body). A TO-role-only change
        // carries no read/write signal, so it is left alone.
        const renamed = body.match(/^RENAME\s+TO\s+(?:"([^"]+)"|(\w+))$/i);
        if (renamed) {
          const newName = renamed[1] !== undefined ? renamed[1] : renamed[2].toLowerCase();
          if (state.has(key)) {
            const value = state.get(key);
            state.delete(key);
            state.set(`${table}|${newName}`, value);
          }
        } else if (/\bUSING\s*\(|\bWITH\s+CHECK\s*\(/i.test(body)) {
          state.set(key, { file, body });
        }
      }
    }
  }
  return state;
}

/** A policy with no FOR clause is FOR ALL (or an ALTER POLICY body, which
 * never restates FOR), which is why `reads` is true when no write-only FOR
 * clause is present. */
export function findBadPolicies(state) {
  const bad = [];
  for (const [key, { file, body }] of state) {
    const [table, name] = key.split("|");
    const reads = /FOR\s+(SELECT|ALL)\b/i.test(body) || !/FOR\s+(INSERT|UPDATE|DELETE)\b/i.test(body);
    if (reads && /is_admin|'admin'/i.test(body) && !ALLOWED.has(table)) bad.push(`${table}: "${name}" (${file})`);
  }
  return bad;
}

/** files: [{ name, sql }], already sorted in migration order. */
export function checkMigrations(files) {
  const state = replayPolicies(files);
  return { bad: findBadPolicies(state), count: state.size };
}

function main() {
  const dir = fileURLToPath(new URL("../supabase/migrations/", import.meta.url));
  const files = readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((name) => ({ name, sql: readFileSync(join(dir, name), "utf8") }));
  const { bad, count } = checkMigrations(files);
  if (bad.length) {
    console.error("Admin read access to user content (Level 1 privacy forbids it):\n  " + bad.join("\n  "));
    process.exit(1);
  }
  console.log(`admin read policies: ok (${count} policies replayed)`);
}

/** Case-insensitive on win32, where the same file can be spelled two ways
 * (a different drive-letter case, a symlink resolved to another case). */
export function sameModulePath(invokedHref, hereHref) {
  return process.platform === "win32" ? invokedHref.toLowerCase() === hereHref.toLowerCase() : invokedHref === hereHref;
}

/**
 * A straight string compare between `process.argv[1]` and `import.meta.url`
 * (as a path) missed a symlink or a differently-cased drive letter on
 * Windows, so `node scripts/check-admin-read-policies.mjs` could silently
 * skip main() and exit 0 without ever running the check. Resolve argv[1] to
 * its real path before comparing.
 */
function isMainModule() {
  if (!process.argv[1]) return false;
  let invoked;
  try {
    invoked = pathToFileURL(realpathSync(process.argv[1])).href;
  } catch {
    return false;
  }
  return sameModulePath(invoked, import.meta.url);
}

if (isMainModule()) main();
