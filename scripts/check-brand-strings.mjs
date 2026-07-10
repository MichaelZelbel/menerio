#!/usr/bin/env node
// Brand-string ratchet: fails CI when hardcoded brand strings appear in src/.
//
// This repo powers two brands (Menerio + Cherishly) from one codebase — see
// docs/BRANDING.md. User-facing brand strings must go through BRAND from
// "@/lib/brand". This script scans src/**/*.{ts,tsx} for hardcoded
// occurrences and compares per-file counts against the allowlist snapshot
// (scripts/brand-string-allowlist.json — the not-yet-refactored long tail).
//
// Rules:
//   - A file exceeding its allowlisted count fails the build.
//   - A file below its allowlisted count auto-ratchets: run with --update
//     to shrink the snapshot (counts may only go down).
//   - New files with matches fail unless added deliberately via --update.
//
// Usage:
//   node scripts/check-brand-strings.mjs           # check (CI mode)
//   node scripts/check-brand-strings.mjs --update  # rewrite the allowlist

import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = join(ROOT, "src");
const ALLOWLIST_PATH = join(ROOT, "scripts", "brand-string-allowlist.json");

// Patterns for strings that must come from BRAND instead of being hardcoded.
// \bMira\b is case-sensitive and word-bounded, so internal identifiers like
// onAskMira do not match.
const PATTERNS = [
  { name: "Menerio", re: /\bMenerio\b/g },
  { name: "menerio-domain", re: /menerio\.(com|lovable\.app)/gi },
  { name: "Mira", re: /\bMira\b/g },
];

// Sanctioned forms are stripped before counting. The SEOHead title suffix
// ('title="Page — Menerio"') is the blessed way to title a page — SEOHead
// swaps the suffix for the active brand automatically, so new pages using it
// must NOT trip this check.
const SANCTIONED = [
  /title=\{?\s*["'`][^"'`\n]*[—–-]\s*Menerio\s*["'`]\s*\}?/g,
];

// Files that legitimately define or test the brand strings.
const EXCLUDED = [
  "src/brands/",
  "src/lib/brand.ts",
  "src/lib/__tests__/brand.test.ts",
];

function walk(dir, files = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, files);
    else if (/\.(ts|tsx)$/.test(entry)) files.push(full);
  }
  return files;
}

const counts = {};
for (const file of walk(SRC)) {
  const rel = relative(ROOT, file).replace(/\\/g, "/");
  if (EXCLUDED.some((prefix) => rel === prefix || rel.startsWith(prefix))) continue;
  let text = readFileSync(file, "utf8");
  for (const re of SANCTIONED) text = text.replace(re, "");
  let n = 0;
  for (const { re } of PATTERNS) n += (text.match(re) || []).length;
  if (n > 0) counts[rel] = n;
}

if (process.argv.includes("--update")) {
  const sorted = Object.fromEntries(Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)));
  writeFileSync(ALLOWLIST_PATH, JSON.stringify(sorted, null, 2) + "\n");
  console.log(`Allowlist updated: ${Object.keys(sorted).length} files, ${Object.values(sorted).reduce((a, b) => a + b, 0)} total occurrences.`);
  process.exit(0);
}

let allowlist = {};
try {
  allowlist = JSON.parse(readFileSync(ALLOWLIST_PATH, "utf8"));
} catch {
  console.error(`Missing or unreadable ${relative(ROOT, ALLOWLIST_PATH)}. Run with --update to create it.`);
  process.exit(1);
}

const failures = [];
for (const [file, n] of Object.entries(counts)) {
  const allowed = allowlist[file] ?? 0;
  if (n > allowed) failures.push({ file, n, allowed });
}

if (failures.length) {
  console.error("Hardcoded brand strings found (use BRAND from @/lib/brand — see docs/BRANDING.md):\n");
  for (const { file, n, allowed } of failures) {
    console.error(`  ${file}: ${n} occurrence(s), allowlisted ${allowed}`);
  }
  console.error("\nIf an occurrence is genuinely non-user-facing and must stay, add it via:");
  console.error("  node scripts/check-brand-strings.mjs --update");
  process.exit(1);
}

console.log(`Brand-string check passed (${Object.keys(counts).length} allowlisted files within budget).`);
