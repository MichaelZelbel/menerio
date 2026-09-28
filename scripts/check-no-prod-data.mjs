// Backstop for plan rule 5.1 (docs/plans/one-fact-store.md): nothing read out
// of production goes into git. Scans the fact-store files for the shapes a
// leaked secret takes: a JWT, a Supabase secret key, a cron key value.
// The rule itself (counts and ids only, the schema stays in the scratchpad)
// is what prevents a leak; this only catches a mistake. Part of `npm test`.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const FILES = [
  "docs/plans",
  "scripts/rehearsal",
  "scripts/test-fact-store.mjs",
  "scripts/bootstrap-fact-store-test.sql",
  "supabase/rollback/fact_store_backup.sql",
  "supabase/rollback/fact_store_rollback.sql",
];
const MIGRATION = /^2026092909\d+_fact_(store|writer)/;
const SECRETS = [
  [/eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}/, "a JWT"],
  [/sb_secret_[A-Za-z0-9_-]{8,}/, "a Supabase secret key"],
  [/x-cron-key['"]?\s*[:=,]\s*['"][A-Za-z0-9_-]{16,}['"]/i, "a cron key value"],
];

function* walk(path) {
  if (!existsSync(path)) return;
  if (statSync(path).isDirectory()) for (const n of readdirSync(path)) yield* walk(join(path, n));
  else yield path;
}
const files = [...FILES.flatMap((p) => [...walk(p)])];
for (const name of readdirSync("supabase/migrations")) if (MIGRATION.test(name)) files.push(join("supabase/migrations", name));

const problems = [];
for (const file of files) {
  const text = readFileSync(file, "utf8");
  for (const [re, what] of SECRETS) if (re.test(text)) problems.push(`${file}: looks like ${what}`);
}
if (problems.length) {
  console.error(`possible production secret in git:\n  ${problems.join("\n  ")}`);
  process.exit(1);
}
console.log(`no production secrets in ${files.length} fact-store files`);
