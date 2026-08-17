# CI Gate Repair Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `npm run lint` exit 0 and add a check that catches broken edge functions before a deploy does, so CI actually gates again.

**Architecture:** Two independent jobs sharing one outcome. The lint backlog turns out to be almost entirely ESLint parsing Rust build output that should never have been linted, so the fix is one line of config plus nine trivial source edits. The edge-function gap is filled with a small Node script that parses every function and resolves its relative imports, wired into `npm test`'s neighbourhood in CI.

**Tech Stack:** Node 20, ESLint 9 flat config, esbuild (already in the tree via Vite), Vitest, GitHub Actions.

**Spec:** This plan is its own spec. Every number in it was measured on 2026-08-17 against commit `2ec1db47`, and every fix below was executed once and reverted, so the end state is known-reachable rather than predicted.

---

## Read this first

**Nothing here is speculative.** I ran all of it, confirmed the result, and reverted. Specifically:

- `npm run lint` reports **434 errors, 1263 warnings**, exit 1.
- **421 of the 434 errors are ESLint trying to parse Rust build output** under `src-tauri/target/release/build/.../tauri-codegen-assets/*.js` — binary-ish asset files emitted by the Tauri desktop build. They are git-ignored but not ESLint-ignored. Adding one path to the ignore list took the count from 434 to **13**, measured.
- Of those 13: `eslint --fix` cleared **4** automatically, leaving **9** hand edits, all listed below with their exact current text.
- The **1263 warnings do not fail CI**. `npm run lint` is plain `eslint .`, with no `--max-warnings`, and ESLint exits non-zero on errors only. 1219 of them are `@typescript-eslint/no-explicit-any`, deliberately downgraded to `warn` with a comment in `eslint.config.js`. **Leave the warnings alone.** Do not "clean them up" — that is a different, much larger decision and is explicitly out of scope.
- The edge-function check script in Task 3 is **already written and proven** (below, verbatim). I tested it three ways: clean tree passes with exit 0 over 138 files; a broken import statement fails with the right file and line; a mistyped import path fails with the unresolved specifier.

**Why this matters:** on 2026-08-15 a stale test mock made `npm test` fail, and nobody noticed for two days. The reason nobody noticed is that CI never reached the test step — `npm run lint` fails first, and has been failing for far longer. A gate that is always red gates nothing.

---

## Global Constraints

- **Order matters: do Task 1 before Task 2.** Task 1 removes 421 of the 434 errors, so Task 2's nine edits are then verifiable in isolation. Doing them the other way round means grepping nine needles out of a 434-item haystack.
- **`npm run lint` must exit 0 at the end of Task 2.** That is the acceptance test for both tasks. Check it with `npm run lint; echo $?` — reading the summary line is not enough, because ESLint prints a summary either way.
- **Do not touch the 1263 warnings**, and do not change `@typescript-eslint/no-explicit-any` from `warn` to `error`.
- **Do not add `--max-warnings` to the lint script.** It would re-break the gate for a reason nobody asked for.
- **The repo is Lovable-synced and goes stale fast.** `git pull --rebase origin main` before starting, and again before pushing.
- **Work on a branch**, not directly on `main`.
- CI runs, in order: `npm run lint`, `node scripts/check-brand-strings.mjs`, `npm test`, `npm run build` (`.github/workflows/ci.yml`). All four must pass.
- **No deploy is needed for any of this.** Nothing here changes runtime behaviour of a single edge function. If you find yourself reaching for `supabase functions deploy`, you have gone off-plan.

---

## File Structure

**Created:**
- `scripts/check-edge-functions.mjs` — parses every `.ts` under `supabase/functions` and resolves its relative imports. Node-only, no new toolchain.

**Modified:**
- `eslint.config.js` — add build-output directories to `ignores`; allow `@ts-ignore` when it carries a description.
- `package.json` — add a `check:functions` script, make `esbuild` an explicit devDependency, and call the check from `test`.
- `.github/workflows/ci.yml` — add the check as its own step.
- Nine source files, one or two lines each (listed in Task 2).

---

### Task 1: Stop ESLint linting build output

**Files:**
- Modify: `eslint.config.js:8`

**Interfaces:**
- Consumes: nothing.
- Produces: `npm run lint` drops from 434 errors to 13. Still exit 1 — Task 2 finishes the job.

`eslint.config.js` currently ignores only `dist`. ESLint 9's flat config does **not** read `.gitignore`, so everything else that is git-ignored still gets linted, including the Tauri desktop build's asset cache.

- [ ] **Step 1: Measure the starting point**

Run: `npm run lint 2>&1 | tail -3; npm run lint >/dev/null 2>&1; echo "exit: $?"`

Expected: `✖ 1697 problems (434 errors, 1263 warnings)` and `exit: 1`.

If the error count is not 434, the tree has moved since this plan was written. Carry on anyway — the fix is the same — but re-measure at each step rather than trusting the numbers here.

- [ ] **Step 2: Confirm the errors really are build output**

Run:

```bash
npx eslint . -f json -o /tmp/lint.json 2>/dev/null
node -e '
const d=require("/tmp/lint.json"), path=require("path");
let build=0, real=[];
for (const f of d) for (const m of f.messages) {
  if (m.severity!==2) continue;
  const rel=path.relative(process.cwd(), f.filePath).replace(/\\/g,"/");
  if (rel.startsWith("src-tauri/target")||rel.startsWith("dist")) build++;
  else real.push(`${rel}:${m.line} [${m.ruleId||"parse"}]`);
}
console.log("build-output errors:", build);
console.log("real-source errors:", real.length);
real.forEach(r=>console.log("  "+r));
'
```

Expected: `build-output errors: 421`, `real-source errors: 13`, and the 13 listed are the ones in Task 2.

- [ ] **Step 3: Add the ignores**

In `eslint.config.js`, change line 8 from:

```js
  { ignores: ["dist"] },
```

to:

```js
  // ESLint 9 flat config does not read .gitignore, so build output has to be
  // named here. src-tauri/target is the Tauri desktop build's cache; it holds
  // generated asset files that are not JavaScript in any useful sense, and
  // ESLint was reporting 421 parse errors against them. That was the whole
  // reason `npm run lint` failed, and therefore the reason CI never got as far
  // as running the tests.
  { ignores: ["dist", "dev-dist", "src-tauri/target", ".lovable"] },
```

- [ ] **Step 4: Verify the drop**

Run: `npm run lint 2>&1 | tail -3`

Expected: `✖ 1276 problems (13 errors, 1263 warnings)`. Exit is still 1; that is correct at this point.

- [ ] **Step 5: Commit**

```bash
git add eslint.config.js
git commit -m "fix(lint): stop linting Tauri build output

421 of the 434 lint errors were ESLint parse failures against generated asset
files under src-tauri/target. Flat config does not read .gitignore, so they
have to be named explicitly. This is why npm run lint failed, and therefore
why CI never reached npm test."
```

---

### Task 2: Clear the remaining thirteen errors

**Files:**
- Modify: `eslint.config.js` (one rule option)
- Modify: `src/pages/ReviewQueue.tsx:609`, `supabase/functions/menerio-mcp/index.ts:3479`, `supabase/functions/profile-lint/index.ts:121`, `supabase/functions/review-queue-bulk/index.ts:138` (auto-fixable)
- Modify: `scripts/audit-relationships.ts:48`, `supabase/functions/_shared/profile-dedup.ts:70`, `supabase/functions/_shared/profile-normalization.ts:108,115`, `supabase/functions/_shared/wiki-structure.ts:232`

**Interfaces:**
- Consumes: Task 1's ignore list.
- Produces: `npm run lint` exits 0.

- [ ] **Step 1: Let ESLint fix the four it can**

Run: `npx eslint . --fix`

This rewrites four `let` declarations that are never reassigned into `const`:

| File | Line | Current |
|---|---|---|
| `src/pages/ReviewQueue.tsx` | 609 | `let subjectId: string \| null = subjectType === "self" ? null : (p?.subject_id \|\| item.target_entity_id \|\| null);` |
| `supabase/functions/menerio-mcp/index.ts` | 3479 | `let nq = supabase` |
| `supabase/functions/profile-lint/index.ts` | 121 | `let newLabel = adjudication.canonicalLabel \|\| canonicalLabel(row.label);` |
| `supabase/functions/review-queue-bulk/index.ts` | 138 | `let wikiIds: string[] = [];` |

- [ ] **Step 2: Check what --fix changed, and that it changed nothing else**

Run: `git diff --stat`

Expected: exactly those four files, one line each. `--fix` can touch formatting if a formatting rule is enabled; none is here, so anything beyond four single-line changes means something unexpected happened. Read it before continuing.

Run: `npm run lint 2>&1 | tail -2`
Expected: 9 errors remaining.

- [ ] **Step 3: Remove four unnecessary regex escapes**

These are `no-useless-escape`: a backslash before a character that is not special in that position. Removing it does not change what the pattern matches, which is why this is safe.

`supabase/functions/_shared/profile-dedup.ts:70` — `\/` inside a character class:

```ts
    .split(/[,;\/]|\band\b|\bund\b|\balso\b|\bor\b|\boder\b/i)
```
becomes
```ts
    .split(/[,;/]|\band\b|\bund\b|\balso\b|\bor\b|\boder\b/i)
```

`supabase/functions/_shared/profile-normalization.ts:108` — identical line, identical change:

```ts
    .split(/[,;\/]|\band\b|\bund\b|\balso\b|\bor\b|\boder\b/i)
```
becomes
```ts
    .split(/[,;/]|\band\b|\bund\b|\balso\b|\bor\b|\boder\b/i)
```

`supabase/functions/_shared/profile-normalization.ts:115` — `\[` inside a character class:

```ts
    .replace(/[()\[\]{}]/g, " ")
```
becomes
```ts
    .replace(/[()[\]{}]/g, " ")
```

Note the `\]` stays. Only the opening bracket's escape is redundant.

`supabase/functions/_shared/wiki-structure.ts:232` — `\[` inside a character class:

```ts
    if (/(^|[.!?:;]|[-*+>|]|#|\n)\s*(["'“”(\[]\s*)?$/.test(before)) continue;
```
becomes
```ts
    if (/(^|[.!?:;]|[-*+>|]|#|\n)\s*(["'“”([]\s*)?$/.test(before)) continue;
```

- [ ] **Step 4: Prove the regexes still behave identically**

These four sit on text-normalisation paths with real test coverage, so do not just trust the reasoning.

Run: `npx vitest run`
Expected: 409 passed, 0 failed.

Then confirm the two split patterns are genuinely equivalent:

```bash
node -e '
const before = /[,;\/]|\band\b|\bund\b|\balso\b|\bor\b|\boder\b/i;
const after  = /[,;/]|\band\b|\bund\b|\balso\b|\bor\b|\boder\b/i;
const cases = ["a,b", "a;b", "a/b", "x and y", "x und y", "p oder q", "nothing"];
for (const c of cases) {
  const a = JSON.stringify(c.split(before)), b = JSON.stringify(c.split(after));
  console.log((a===b ? "same " : "DIFF ") + c.padEnd(10) + a);
}'
```

Expected: every line starts `same`.

- [ ] **Step 5: Replace the `require()` in the audit script**

`scripts/audit-relationships.ts:44-50` currently reads:

```ts
const fileArg = process.argv.indexOf("--file");
const raw =
  fileArg > -1
    ? require("node:fs").readFileSync(process.argv[fileArg + 1], "utf8").trim()
    : execFileSync("psql", ["-At", "-c", SQL], { encoding: "utf8" }).trim();
```

Add `readFileSync` to the file's existing imports at the top (check what is already imported from `node:child_process` and follow the same style), then change the body to:

```ts
const fileArg = process.argv.indexOf("--file");
const raw =
  fileArg > -1
    ? readFileSync(process.argv[fileArg + 1], "utf8").trim()
    : execFileSync("psql", ["-At", "-c", SQL], { encoding: "utf8" }).trim();
```

with, at the top of the file:

```ts
import { readFileSync } from "node:fs";
```

- [ ] **Step 6: Allow `@ts-ignore` when it explains itself — do NOT swap it for `@ts-expect-error`**

The last four errors are `@typescript-eslint/ban-ts-comment` at `supabase/functions/profile-audit/index.ts` lines 290, 348, 355 and 375. All four are the same line:

```ts
      // @ts-ignore Deno runtime global
```

**The rule's suggested fix is wrong here, and taking it would create a bug.** `@ts-expect-error` fails when the line below it has *no* error. These comments sit above uses of the `Deno` global. Nothing currently typechecks this directory, so today the swap is inert — but Task 3's optional Deno step, and any future `deno check`, would resolve `Deno` perfectly well, at which point every one of these four `@ts-expect-error` comments becomes an error in its own right.

Configure the rule to accept a described `@ts-ignore` instead. In `eslint.config.js`, inside the `rules` block, add:

```js
      // @ts-ignore is allowed when it says why. The alternative the rule
      // suggests, @ts-expect-error, errors when the line below it has no
      // error — and the four uses in supabase/functions/profile-audit sit
      // above the `Deno` global, which nothing typechecks today but a Deno
      // check would resolve fine. Swapping them would break the moment anyone
      // adds one.
      "@typescript-eslint/ban-ts-comment": [
        "error",
        { "ts-ignore": "allow-with-description", minimumDescriptionLength: 3 },
      ],
```

The four existing comments already carry the description `Deno runtime global`, which is 19 characters, so they pass.

- [ ] **Step 7: Verify the gate is green**

Run:

```bash
npm run lint 2>&1 | tail -3
npm run lint >/dev/null 2>&1; echo "lint exit: $?"
```

Expected: `✖ 1259 problems (0 errors, 1259 warnings)` and `lint exit: 0`.

**`lint exit: 0` is the whole point of this task.** A summary line showing 0 errors but a non-zero exit means something else is failing; investigate before moving on.

Then confirm nothing else broke:

```bash
npx vitest run && npm run build
```

Expected: 409 tests pass, build succeeds.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "fix(lint): clear the last thirteen errors so the gate exits 0

Four const-instead-of-let via --fix, four redundant regex escapes, one
require() in a script, and a rule option so a described @ts-ignore is allowed.

ban-ts-comment is configured rather than obeyed on purpose: its suggested
@ts-expect-error errors when the line below has no error, and the four uses in
profile-audit sit above the Deno global, which a Deno typecheck resolves fine.
Swapping them would break as soon as one is added.

Warnings are untouched: 1219 are the deliberately-downgraded no-explicit-any
and do not affect the exit code."
```

---

### Task 3: Check edge functions before a deploy has to

**Files:**
- Create: `scripts/check-edge-functions.mjs`
- Modify: `package.json`
- Modify: `.github/workflows/ci.yml`

**Interfaces:**
- Consumes: nothing from Tasks 1 and 2.
- Produces: `npm run check:functions`, exit 0 when clean and 1 with a file and line when not.

**Why this exists.** `tsconfig.app.json` only covers `src/`, and Vitest only collects `src/**` plus `supabase/functions/**/__tests__/**`. So the ~130 edge-function source files are checked by *nothing* in this repo. On 2026-08-17 four `import` statements were inserted into the middle of a multi-line `import {` block — a hard parse error — and `npm test`, `tsc --noEmit` and `npm run build` all passed. The Supabase bundler caught it, at deploy time, four functions at once.

**What it deliberately does not do.** It does not typecheck. Full type checking needs Deno, because these modules import from `https://esm.sh/...` and use the `Deno` global. That is Step 6, optional, with its own trade-off. This script catches the two things that actually break a deploy, in about a second, with no new toolchain.

- [ ] **Step 1: Make esbuild an explicit dependency**

It currently resolves only because Vite depends on it. Relying on a transitive dependency is how a script breaks during an unrelated upgrade.

Run: `npm install --save-dev esbuild`

Expected: `package.json` gains `"esbuild"` under `devDependencies` at roughly `^0.25.12` (the version already in the tree). No meaningful download — it is already installed.

- [ ] **Step 2: Write the script**

Create `scripts/check-edge-functions.mjs` exactly as below. This is the version I tested; the `.ts`-extension fallback in the import check is load-bearing, because the Vitest files under `__tests__/` are resolved by Node and correctly omit the extension, and without it they produce two false failures.

```js
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
```

- [ ] **Step 3: Verify it passes on a clean tree**

Run: `node scripts/check-edge-functions.mjs; echo "exit: $?"`

Expected: `edge-function check passed: 138 files parsed, imports resolve` and `exit: 0`.

If it reports the two `__tests__` files as unresolved imports, the `.ts` fallback from Step 2 was not copied correctly.

- [ ] **Step 4: Verify it fails on the bug it exists to catch**

A check nobody has seen fail is a check nobody should trust. Break a file deliberately, both ways, then restore it.

```bash
# (a) a syntax error, exactly the shape of the 2026-08-17 bug
python3 -c "
import io
p='supabase/functions/hub-api-notes/index.ts'; s=io.open(p,encoding='utf-8').read()
s=s.replace('import { ilikeAnyColumn } from \"../_shared/postgrest-filters.ts\";\nimport {',
            'import {\nimport { ilikeAnyColumn } from \"../_shared/postgrest-filters.ts\";',1)
io.open(p,'w',encoding='utf-8',newline='').write(s)"
node scripts/check-edge-functions.mjs; echo "exit: $?"
git checkout -- supabase/functions/hub-api-notes/index.ts

# (b) an import path that does not exist
python3 -c "
import io
p='supabase/functions/hub-api-notes/index.ts'; s=io.open(p,encoding='utf-8').read()
io.open(p,'w',encoding='utf-8',newline='').write(s.replace('postgrest-filters.ts','postgrest-filterz.ts',1))"
node scripts/check-edge-functions.mjs; echo "exit: $?"
git checkout -- supabase/functions/hub-api-notes/index.ts
```

Expected (a): `hub-api-notes/index.ts:5  syntax: Expected "as" but found "{"`, exit 1.
Expected (b): `hub-api-notes/index.ts  unresolved import: "../_shared/postgrest-filterz.ts"`, exit 1.

Then confirm you restored it: `git status --short` shows nothing, and the check passes again.

- [ ] **Step 5: Wire it in**

In `package.json`, add the script and chain it into `test` so it runs locally too:

```json
    "test": "node scripts/check-edge-functions.mjs && vitest run",
    "check:functions": "node scripts/check-edge-functions.mjs",
```

Keep `"test:watch": "vitest"` as it is — the check has no place in a watch loop.

In `.github/workflows/ci.yml`, add a step of its own after the lint step, so a failure is labelled rather than buried inside the test step:

```yaml
      - run: npm run lint
      - run: npm run check:functions
      - run: node scripts/check-brand-strings.mjs
      - run: npm test
      - run: npm run build
```

Run: `npm test`
Expected: the check line prints first, then 409 tests pass.

- [ ] **Step 6 (optional, and a real decision): add a full Deno typecheck**

Everything above catches syntax and missing files. It does not catch type errors, and a type error can still break a deploy.

`deno check` would catch them. The cost, honestly:

- CI needs a `denoland/setup-deno@v2` step, roughly 10 to 20 seconds.
- Nobody on Windows has Deno locally, so it would be a CI-only check — the class of gate that is annoying to reproduce when it fails.
- **It will almost certainly surface a backlog of pre-existing type errors on first run**, because nothing has ever typechecked these files. That is a separate cleanup of unknown size, and finding out how big it is *is* the first step.

So do not add it blind. Measure first:

```bash
# only if Deno is available; skip this step entirely otherwise
deno check supabase/functions/**/index.ts 2>&1 | tail -40
```

Then report the count to Michael and let him decide, rather than starting an open-ended cleanup inside this plan. If the number is small, adding the step is worth it. If it is in the hundreds, it is its own piece of work and should be its own plan.

- [ ] **Step 7: Commit**

```bash
git add scripts/check-edge-functions.mjs package.json package-lock.json .github/workflows/ci.yml
git commit -m "ci: check edge functions parse and their imports resolve

Nothing in this repo checked supabase/functions: tsconfig.app.json covers only
src/, and vitest collects src/ plus the __tests__ folders. So on 2026-08-17
four import statements inserted into the middle of a multi-line import passed
npm test, tsc --noEmit and npm run build, and were caught by the Supabase
bundler at deploy time.

Parses every .ts file and resolves every relative import, in about a second,
with no new toolchain. Deliberately does not typecheck: that needs Deno, and
the size of the existing backlog is unknown."
```

---

### Task 4: Confirm the gate actually gates

**Files:** none.

**Interfaces:**
- Consumes: Tasks 1, 2 and 3.

A green run proves the steps pass. It does not prove the gate would catch a regression, which is the thing that was actually broken.

- [ ] **Step 1: Full local run, in CI's order**

```bash
npm run lint;                         echo "lint:      $?"
npm run check:functions;              echo "functions: $?"
node scripts/check-brand-strings.mjs; echo "brand:     $?"
npx vitest run >/dev/null 2>&1;       echo "test:      $?"
npm run build >/dev/null 2>&1;        echo "build:     $?"
```

Expected: all five report `0`.

- [ ] **Step 2: Prove each gate still bites**

Break one thing per gate, confirm the exit code, restore it. Verify `git status --short` is empty after each.

```bash
# lint: a never-reassigned `let` is a prefer-const ERROR, so it must fail the gate
printf '\nexport function __lintProbe() { let probe = 1; return probe; }\n' \
  >> supabase/functions/_shared/hub-source.ts
npm run lint >/dev/null 2>&1; echo "lint should be 1: $?"
git checkout -- supabase/functions/_shared/hub-source.ts
npm run lint >/dev/null 2>&1; echo "lint back to 0: $?"

# functions: covered by Task 3 Step 4 — re-run that if you want belt and braces

# test: break the mock the same way it was broken on 2026-08-15
python3 -c "
import io; p='src/hooks/__tests__/useContactProfile.test.tsx'
s=io.open(p,encoding='utf-8').read()
io.open(p,'w',encoding='utf-8',newline='').write(s.replace('ok: true','ok: false',1))"
npx vitest run >/dev/null 2>&1; echo "test should be 1: $?"
git checkout -- src/hooks/__tests__/useContactProfile.test.tsx
```

Expected: `lint should be 1: 1`, `lint back to 0: 0`, `test should be 1: 1`.

If any of those reports the opposite, that gate is not gating and it is a finding worth reporting rather than working around.

- [ ] **Step 3: Push and watch CI**

```bash
git pull --rebase origin main
npx vitest run && npm run lint && npm run check:functions   # after the rebase
git push origin HEAD
gh run watch
```

Expected: all steps green. **This is the first green CI run on this repo in a long time**, so if it goes green, say so explicitly in the report rather than treating it as unremarkable.

- [ ] **Step 4: Merge**

```bash
git checkout main && git pull --rebase origin main
git merge --no-ff --no-edit <branch>
npm run lint && npm run check:functions && npx vitest run && npm run build
git push origin main
```

---

## What to report back

1. `npm run lint` exit code, before and after.
2. The error count at each stage: start, after Task 1, after Task 2.
3. Whether the edge-function check was seen to fail on a deliberately broken file, with the message it printed.
4. Whether CI went green, with the run URL.
5. If Step 6 of Task 3 was measured: how many Deno type errors exist, and a recommendation on whether to take that on.
6. Anything found along the way that is not in this plan.

## Out of scope

Named so they are not quietly picked up: the 1263 ESLint warnings, of which 1219 are the deliberately-downgraded `no-explicit-any`; the 21 `react-hooks/exhaustive-deps` warnings, which are real but each needs individual judgement about whether adding the dependency changes behaviour; converting `no-explicit-any` to an error; and any change to edge-function runtime behaviour, since nothing in this plan requires a deploy.
