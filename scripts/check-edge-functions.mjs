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
const CRON_GATED = [
  "profile-reconcile",
  "profile-audit",
  "wiki-restructure",
  "powersync-keepalive",
  "admin-normalize",
];
for (const fn of CRON_GATED) {
  const file = join(ROOT, fn, "index.ts");
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
