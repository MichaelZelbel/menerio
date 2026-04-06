# Contributing to Menerio

Thanks for your interest in contributing! Here's what you need to get started.

## Local Setup

1. Clone the repository
2. Copy `.env.example` to `.env` and fill in your Supabase credentials
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

## Running Checks

```bash
npm run lint      # ESLint
npm run test      # Vitest (unit tests)
npm run build     # Verify the production build compiles
```

## CI

A GitHub Actions workflow runs automatically on every pull request and push to `main`. It executes the same three checks listed above (`lint`, `test`, `build`). All checks must pass before a PR can be merged.

## Secrets & Environment

- **Never commit `.env` or any file containing real secrets.**
- `.env.example` is tracked and should be updated if you add new environment variables.
- Use clear placeholder values in `.env.example` (e.g. `YOUR_SUPABASE_URL`).

## Questions?

Open an issue if anything is unclear. We're happy to help.
