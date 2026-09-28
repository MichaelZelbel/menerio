#!/usr/bin/env node
// Which edge functions the fact store go-live must deploy, and which the
// rollback must redeploy from the recorded main commit (docs/plans/one-fact-store.md,
// B1 and 5.4; eleventh review).
//
// An edge function is bundled at deploy time with every _shared module it
// imports. So a function whose own folder did not change still runs the OLD
// copy of a changed _shared module until it is deployed again. Reading
// `git diff --name-only` folder by folder misses those: on this branch it named
// 17 functions, while 39 bundle a changed file, among them collection-chat and
// the three GitHub people-sync functions, whose deployed code reads
// profile_entries and fails once the switch renames it.
//
//   node scripts/golive/functions-to-deploy.mjs [base-ref]   (default origin/main)
//
// Prints JSON: deploy (menerio-mcp last), redeploy_on_rollback (the same
// functions that exist at base-ref), delete_on_rollback (new on this branch).

import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const IMPORT = /(?:from|import)\s*\(?\s*["'](\.{1,2}\/[^"']+)["']/g;

/** Every file a function's bundle contains: its own .ts files and their relative imports, transitively. */
export function bundleFiles(functionsRoot, name) {
  const seen = new Set();
  const visit = (file) => {
    const f = normalize(file);
    if (seen.has(f) || !existsSync(f)) return;
    seen.add(f);
    for (const m of readFileSync(f, "utf8").matchAll(IMPORT)) visit(join(dirname(f), m[1]));
  };
  const dir = join(functionsRoot, name);
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.isFile() && e.name.endsWith(".ts")) visit(join(dir, e.name));
  }
  return seen;
}

/** Functions (folders with an index.ts) whose bundle includes one of the changed files. */
export function functionsToDeploy(functionsRoot, changedFiles) {
  const changed = new Set(changedFiles.map((p) => normalize(p)));
  const names = readdirSync(functionsRoot, { withFileTypes: true })
    .filter((e) => e.isDirectory() && e.name !== "_shared" && existsSync(join(functionsRoot, e.name, "index.ts")))
    .map((e) => e.name)
    .sort();
  const hit = names.filter((n) => [...bundleFiles(functionsRoot, n)].some((f) => changed.has(f)));
  // menerio-mcp last: it is what assistants call, so it changes after everything it reads.
  return [...hit.filter((n) => n !== "menerio-mcp"), ...hit.filter((n) => n === "menerio-mcp")];
}

if (process.argv[1] && fileURLToPath(import.meta.url) === normalize(process.argv[1])) {
  const base = process.argv[2] ?? "origin/main";
  const root = "supabase/functions";
  const git = (...a) => execFileSync("git", a, { encoding: "utf8" });
  const changed = git("diff", "--name-only", `${base}...HEAD`, "--", root).split("\n").filter(Boolean);
  const deploy = functionsToDeploy(root, changed);
  const atBase = new Set(git("ls-tree", "-d", "--name-only", `${base}:${root}`).split("\n").filter(Boolean));
  console.log(JSON.stringify({
    base,
    deploy,
    redeploy_on_rollback: deploy.filter((n) => atBase.has(n)),
    delete_on_rollback: deploy.filter((n) => !atBase.has(n)),
  }, null, 2));
}
