#!/usr/bin/env node
/**
 * Syntax- and import-check every Supabase edge function.
 *
 * `npm test` and `tsc --noEmit` both skip supabase/functions entirely:
 * tsconfig.app.json only covers src/, and Vitest only collects src/** plus
 * supabase/functions/ ** /__tests__/**. On 2026-08-17 four import statements
 * were inserted into the middle of a multi-line import, which is a hard parse
 * error, and nothing in the repo noticed until the Supabase bundler rejected
 * the deploy. This closes that gap in about a second.
 *
 * Three checks, all aimed at what actually breaks a deploy or reopens a hole:
 *   1. every .ts file parses
 *   2. every relative import points at a file that exists
 *   3. scheduler-triggered functions keep their cron authentication
 *
 * Check 3 exists because on 2026-08-26 five functions were found accepting a
 * plaintext body marker ({"cron": ...}) as full service trust — replayable by
 * anyone with the URL. They now verify the x-cron-key header via
 * _shared/cron-auth.ts, and this check fails the build if that call ever
 * disappears again (agent-driven edits regress exactly this way), or if a
 * hardcoded anon JWT sneaks back in as an auth fallback.
 *
 * It deliberately does NOT typecheck. That needs Deno, because these modules
 * import from https://esm.sh/... and use the Deno global. This runs anywhere
 * Node does and needs no new toolchain.
 */
import { transformSync } from "esbuild";
import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { join, dirname, resolve } from "node:path";

const ROOT = "supabase/functions";
const files = [];
(function walk(dir) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else if (e.name.endsWith(".ts")) files.push(p);
  }
})(ROOT);

const problems = [];

for (const file of files) {
  const src = readFileSync(file, "utf8");

  // 1. does it parse?
  try {
    transformSync(src, { loader: "ts", format: "esm" });
  } catch (err) {
    const e = err.errors?.[0];
    problems.push(
      `${file}:${e?.location?.line ?? "?"}  syntax: ${e?.text ?? err.message}`
    );
    continue; // a file that will not parse cannot be import-checked
  }

  // 2. do its relative imports resolve? URL and npm: specifiers are Deno's job.
  const specs = [...src.matchAll(/\bfrom\s+["'](\.[^"']+)["']/g)].map((m) => m[1]);
  for (const spec of specs) {
    const base = resolve(dirname(file), spec);
    // Deno modules import with an explicit .ts; the vitest files under
    // __tests__/ are resolved by Node and legitimately omit it.
    const isFile = (p) => existsSync(p) && statSync(p).isFile();
    if (!(isFile(base) || isFile(base + ".ts") || isFile(join(base, "index.ts")))) {
      problems.push(`${file}  unresolved import: "${spec}"`);
    }
  }
}

// 3. scheduler-triggered functions must authenticate the scheduler.
//
// The list below was hand-written, which made it the weakest part of this check:
// a function newly put on a schedule is protected only if somebody remembers to
// add it here, and forgetting leaves no trace. The schedule itself is not a
// matter of memory — it is in the migrations, as internal.call_edge('name') and
// cron.schedule(...) — so the list is read from there and the hardcoded names are
// only a floor, kept so that removing a cron line cannot quietly drop a gate that
// is still needed.
const CRON_GATED_FLOOR = [
  "github-sync-scheduled",
  "drain-note-ai-jobs",
  "profile-reconcile",
  "profile-audit",
  "wiki-restructure",
  "powersync-keepalive",
  "admin-normalize",
];

function scheduledFunctionNames() {
  const found = new Set();
  const dir = "supabase/migrations";
  if (!existsSync(dir)) return found;
  for (const name of readdirSync(dir)) {
    if (!name.endsWith(".sql")) continue;
    const sql = readFileSync(join(dir, name), "utf8");
    // internal.call_edge('fn-name', …) — how pg_cron reaches a function here.
    for (const m of sql.matchAll(/call_edge\s*\(\s*'([a-z0-9-]+)'/gi)) found.add(m[1]);
    // A direct pg_net post to /functions/v1/fn-name from a cron job.
    for (const m of sql.matchAll(/\/functions\/v1\/([a-z0-9-]+)/gi)) found.add(m[1]);
  }
  return found;
}

// notify-admin is reached by pg_net from a row trigger rather than by the
// scheduler, and it authenticates with the service-role key instead of the cron
// key. It is gated, just not by this mechanism.
const NOT_CRON_GATED = new Set(["notify-admin"]);

const cronGated = new Set(CRON_GATED_FLOOR);
for (const fn of scheduledFunctionNames()) if (!NOT_CRON_GATED.has(fn)) cronGated.add(fn);

for (const fn of [...cronGated].sort()) {
  const file = join(ROOT, fn, "index.ts");
  // A renamed or deleted function used to crash this script with a bare ENOENT
  // stack, which reads like a broken tool rather than a finding.
  if (!existsSync(file)) {
    problems.push(`${file}  scheduled in a migration but the function does not exist (renamed or deleted?)`);
    continue;
  }
  const src = readFileSync(file, "utf8");
  if (!/\bisValidCronRequest\s*\(/.test(src)) {
    problems.push(`${file}  cron auth missing: must call isValidCronRequest() from _shared/cron-auth.ts`);
  }
}
for (const file of files) {
  const src = readFileSync(file, "utf8");
  // The anon key is public, but as an AUTH input it is worthless; a committed
  // anon JWT literal only ever shows up as a fake cron credential.
  if (/eyJ[A-Za-z0-9_-]{80,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/.test(src)) {
    problems.push(`${file}  hardcoded JWT literal: never embed project keys in function code`);
  }
}

if (problems.length) {
  console.error(`\nedge-function check FAILED (${problems.length} problem(s)):\n`);
  for (const p of problems) console.error("  " + p);
  console.error("");
  process.exit(1);
}
console.log(`edge-function check passed: ${files.length} files parsed, imports resolve, cron gates present`);
