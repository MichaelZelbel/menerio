

## Fix CI Lint Errors (4 errors)

The GitHub Actions CI is failing due to 3 lint errors introduced in recent changes:

### Errors

1. **`process-note/index.ts` lines 306 & 311** — `var` used instead of `let`/`const`. The `contactMap` variable is declared with `var` in both branches of an if/else.
2. **`NoteMetadataEditor.tsx` line 126** — Empty `catch {}` block (lint rule `no-empty`).

### Fixes

**File: `supabase/functions/process-note/index.ts`**
- Move `contactMap` declaration before the `if` block as `let contactMap: Record<string, string> = {};`, then assign inside each branch. Or simpler: declare it once before the `if` with `let`, and populate inside.

**File: `src/components/notes/NoteMetadataEditor.tsx`**
- Change `catch {}` to `catch { /* ignored */ }` (a comment satisfies the `no-empty` rule).

### Scope
Three lines changed across two files. No functionality changes.

