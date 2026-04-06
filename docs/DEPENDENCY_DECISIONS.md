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
