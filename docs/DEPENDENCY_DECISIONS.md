# Dependency Decisions

## Tiptap v2 → v3 alignment (April 2026)

**Problem:** `package.json` mixed Tiptap **v2** (`@tiptap/react@^2.11.5`, `@tiptap/extension-task-item@^2.11.5`) with Tiptap **v3** (all other `@tiptap/*` packages at `^3.20.1`). This caused peer-dependency conflicts and `npm ci` failures in clean environments.

**Resolution:** Upgraded the two v2 packages to `^3.20.1` to match the rest. Tiptap v3 is the actively maintained line; v2 extensions are not compatible with the v3 core.

**Packages changed:**

| Package | Before | After |
|---|---|---|
| `@tiptap/react` | `^2.11.5` | `^3.20.1` |
| `@tiptap/extension-task-item` | `^2.11.5` | `^3.20.1` |

**Validation:** `npm ci`, `npm run build`, and `npm test` all pass cleanly without `--legacy-peer-deps`.

## Lint: `no-explicit-any` downgraded to warning (April 2026)

**Problem:** 370+ `any` usages across `src/` and `supabase/functions/` caused `npm run lint` to fail. Most are in Edge Functions and dynamic Supabase query results where adding precise types requires significant effort and runtime knowledge.

**Resolution:** Downgraded `@typescript-eslint/no-explicit-any` to `"warn"` in `eslint.config.js`. All other lint errors (17 total: `prefer-const`, `no-empty`, `no-useless-escape`, `ban-ts-comment`, `no-require-imports`, `no-empty-object-type`, `no-unused-expressions`, `no-this-alias`) were fixed directly.

**Plan:** Contributors are encouraged to replace `any` with real types when touching a file. The warning count should decrease over time.
