// After the one fact store (docs/plans/one-fact-store.md), no application code
// reads or writes profile_entries: the table is renamed to profile_entries_archive
// at go-live and nobody but the migrations may touch it. Part of `npm test`.
//
// Exempt: migrations, rollbacks, the switch harness and rehearsal scripts, and
// the generated Supabase types. Tests may mention the name to assert it is gone.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOTS = ["src", "supabase/functions"];
// build-fact-label-map reads the old labels before the switch and is deleted in B6.
const EXEMPT = [/\/__tests__\//, /\.test\.tsx?$/, /src\/integrations\/supabase\/types\.ts$/, /supabase\/functions\/build-fact-label-map\//];
// Eleventh review: the first version matched `.from("profile_entries")` only, so
// the table name handed to a helper, the retired SQL functions and edge
// functions, and the old cache keys (which hid a stale page after a merge) all
// passed. Any quoted mention now counts.
const RETIRED_SQL = [
  "profile_audit_apply_merge", "profile_audit_rollback_merge", "cleanup_profile_duplicates",
  "cleanup_profile_token_duplicates", "profile_dedup_sweep", "profile_subset_label_sweep",
  "profile_existing_token_keys", "profile_resolve_label", "backfill_accumulator_profile_entries",
];
const RETIRED_FUNCTIONS = ["promote-profile-entries", "profile-audit", "admin-normalize"];
const PATTERNS = [
  /["'`]profile_entries(?:_archive)?["'`]/,
  /\b(?:from|into|update|join|table)\s+(?:public\.)?profile_entries\b/i,
  new RegExp(`["'\`/](?:${RETIRED_SQL.join("|")})["'\`]`),
  new RegExp(`(?:["'\`]|functions/v1/)(?:${RETIRED_FUNCTIONS.join("|")})["'\`/?]`),
  /["'`](?:contact-)?profile-entries["'`]/,
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
    if (EXEMPT.some((re) => re.test(file.replaceAll("\\", "/")))) continue;
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
