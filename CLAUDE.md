# Notes for Claude sessions

## Plans

- The plan for the fact store is `docs/plans/one-fact-store.md` on `main`. It is the only copy.
- Read it from `main` (`git fetch origin main` first). Do not look for versions of it on other branches.
- When you change the plan, commit the change to `main` and push it before the session ends. This applies even if the session was started on its own branch. Never leave plan changes on any other branch.

## New tables need explicit grants

Supabase stopped auto-granting new `public` tables on 2026-10-30, so every migration that creates a table, view or materialized view in `public` grants it in the same file (or revokes it on purpose), or the app gets "permission denied". Template, keeping only the lines that apply:

```sql
grant select on public.x to anon;  -- only if anon should read it
grant select, insert, update, delete on public.x to authenticated;
grant select, insert, update, delete on public.x to service_role;
```

Details (serial sequences, private tables) are in `CONTRIBUTING.md`; `npm run check:grants` checks it. Never change the live database's default privileges.
