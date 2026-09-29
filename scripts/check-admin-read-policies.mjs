#!/usr/bin/env node
/**
 * Fail if any migration leaves an admin able to READ a table outside the
 * allowlist. Replays every CREATE/DROP POLICY (and DROP TABLE) in migration
 * order, then looks at the surviving SELECT/ALL policies that mention is_admin
 * or the 'admin' role. Level 1 privacy (docs/superpowers/plans/2026-09-29-
 * admin-privacy-and-avatar-removal.md): staff get account and billing data,
 * never content. Keep ALLOWED identical to the list in
 * supabase/migrations/20261001100300_remove_admin_content_reads.sql.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ALLOWED = new Set([
  "user_roles", "ai_allowance_periods", "user_suspensions", "llm_usage_events",
  "llm_call_configs", "moderation_stopwords", "moderation_events",
  "moderation_review_queue", "ai_credit_settings",
]);
const dir = fileURLToPath(new URL("../supabase/migrations/", import.meta.url));
const norm = (t) => t.replace(/"/g, "").replace(/^public\./i, "");
const state = new Map();
for (const file of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
  const sql = readFileSync(join(dir, file), "utf8").replace(/--[^\n]*/g, "");
  const re = /(CREATE|DROP)\s+POLICY\s+(?:IF\s+EXISTS\s+)?"([^"]+)"\s+ON\s+([\w."]+)([\s\S]*?);|DROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?([\w."]+)/gi;
  for (const m of sql.matchAll(re)) {
    if (m[5]) {
      const t = norm(m[5]);
      for (const k of [...state.keys()]) if (k.startsWith(`${t}|`)) state.delete(k);
      continue;
    }
    const key = `${norm(m[3])}|${m[2]}`;
    if (m[1].toUpperCase() === "DROP") state.delete(key);
    else state.set(key, { file, body: m[4].replace(/\s+/g, " ") });
  }
}
const bad = [];
for (const [key, { file, body }] of state) {
  const [table, name] = key.split("|");
  const reads = /FOR\s+(SELECT|ALL)\b/i.test(body) || !/FOR\s+(INSERT|UPDATE|DELETE)\b/i.test(body);
  if (reads && /is_admin|'admin'/i.test(body) && !ALLOWED.has(table)) bad.push(`${table}: "${name}" (${file})`);
}
if (bad.length) {
  console.error("Admin read access to user content (Level 1 privacy forbids it):\n  " + bad.join("\n  "));
  process.exit(1);
}
console.log(`admin read policies: ok (${state.size} policies replayed)`);
