// After the one fact store (docs/plans/one-fact-store.md), no application code
// reads or writes profile_entries: the table is renamed to profile_entries_archive
// at go-live and nobody but the migrations may touch it. Part of `npm test`.
//
// Exempt: migrations, rollbacks, the switch harness and rehearsal scripts, and
// the generated Supabase types. Tests may mention the name to assert it is gone.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOTS = ["src", "supabase/functions"];
const EXEMPT = [/\/__tests__\//, /\.test\.tsx?$/, /src\/integrations\/supabase\/types\.ts$/];
const PATTERNS = [
  /\.from\(\s*["'`]profile_entries["'`]\s*\)/,
  /\b(?:from|into|update|join|table)\s+(?:public\.)?profile_entries\b/i,
  /functions\/v1\/promote-profile-entries|invoke\(\s*["'`]promote-profile-entries/,
];

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (name === "node_modules") continue;
    if (statSync(path).isDirectory()) yield* walk(path);
    else if (/\.(ts|tsx|mjs|js)$/.test(name)) yield path;
  }
}

const problems = [];
for (const root of ROOTS) {
  for (const file of walk(root)) {
    if (EXEMPT.some((re) => re.test(file))) continue;
    const lines = readFileSync(file, "utf8").split("\n");
    lines.forEach((line, i) => {
      if (PATTERNS.some((re) => re.test(line))) problems.push(`${file}:${i + 1}  ${line.trim().slice(0, 120)}`);
    });
  }
}
if (problems.length) {
  console.error(`profile_entries is retired; ${problems.length} use(s) left:\n  ${problems.join("\n  ")}`);
  process.exit(1);
}
console.log("no application code reads or writes profile_entries");
