# Contributing to Menerio

Thanks for your interest in contributing! Here's what you need to get started.

## Local Setup

1. Clone the repository
2. Copy `.env.example` to `.env` and fill in your Supabase credentials. Note: the main Supabase client in `src/integrations/supabase/client.ts` is generated with the hosted project's URL and key written in, so pointing the app at your own project also means changing that file.
3. Install dependencies: `npm install`
4. Start the dev server: `npm run dev`

## Branching

- Create a feature branch from `main`: `git checkout -b feature/your-change`
- Keep branches focused on a single change or feature
- Open a pull request when ready for review

## Making Changes

- **Keep changes small and focused.** One PR per feature or fix.
- **Follow existing patterns.** Components are grouped by domain in `src/components/`, one page per route in `src/pages/`.
- **Use design tokens.** Colors and spacing come from `src/index.css` and `tailwind.config.ts` — don't hard-code values.
- **Don't edit auto-generated files.** `src/integrations/supabase/types.ts` is generated from the database schema.

## Schema & Architecture Changes

If your change touches the database schema or overall architecture:

- Update `docs/DATA_MODEL.md` for new or changed entities
- Update `docs/ARCHITECTURE.md` or `docs/PROJECT_STRUCTURE.md` if the structure changes
- Document any new Edge Functions in the architecture docs

### Every new table needs explicit grants

Since 2026-10-30 Supabase no longer grants new tables in `public` to `anon`, `authenticated` or `service_role` automatically ([changelog](https://supabase.com/changelog/45329-breaking-change-tables-not-exposed-to-data-and-graphql-api-automatically)). A table, view or materialized view created without grants answers "permission denied" to the app, to PostgREST and to every edge function, and so does every table after a rebuild from migrations. So a migration that creates one grants it in the same file, keeping only the lines that apply:

```sql
grant select on public.x to anon;  -- only if anon should read it
grant select, insert, update, delete on public.x to authenticated;
grant select, insert, update, delete on public.x to service_role;
```

A table with a `serial`/`bigserial` column that `authenticated` may insert into also needs `grant usage, select on sequence public.x_id_seq to authenticated;` (identity columns need nothing). A table that is private on purpose says so with an explicit `revoke all on public.x from anon, authenticated;`. `npm run check:grants` (also part of `npm test`, CI, the `.githooks/pre-push` hook and `scripts/rehearsal/prod-apply.sh`) fails on any migration from `20261020000000` on that forgets. Turn the hook on once per clone with `git config core.hooksPath .githooks`.

## Running Checks

```bash
npm run lint      # ESLint
npm run test      # Edge function check, then Vitest (unit tests)
npm run build     # Verify the production build compiles
```

## CI

A GitHub Actions workflow (`.github/workflows/ci.yml`) runs automatically on every pull request and push to `main`. Besides the three checks above it runs `node scripts/check-brand-strings.mjs`, a type check (`npx tsc --noEmit -p tsconfig.app.json`), SQL tests against a throwaway Postgres, and a browser test. All checks must pass before a PR can be merged.

## Secrets & Environment

- **Never commit `.env` or any file containing real secrets.**
- `.env.example` is tracked and should be updated if you add new environment variables.
- Use clear placeholder values in `.env.example` (e.g. `YOUR_SUPABASE_URL`).

## Questions?

Open an issue if anything is unclear. We're happy to help.
