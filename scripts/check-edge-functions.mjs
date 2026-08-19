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
 * Two checks, both aimed at what actually breaks a deploy:
 *   1. every .ts file parses
 *   2. every relative import points at a file that exists
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

if (problems.length) {
  console.error(`\nedge-function check FAILED (${problems.length} problem(s)):\n`);
  for (const p of problems) console.error("  " + p);
  console.error("");
  process.exit(1);
}
console.log(`edge-function check passed: ${files.length} files parsed, imports resolve`);
