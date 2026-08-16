# Deferred migrations

SQL in this folder is written but **not yet applied**. It is deliberately outside
`supabase/migrations/`, because everything in that folder runs on the next deploy and
these statements are meant to wait.

Moving a file from here into `supabase/migrations/` (keeping the timestamp prefix in
order) is what schedules it for the next deploy.

| File | Waits for |
|---|---|
| `revoke-legacy-mcp-token.sql` | A full day of the single Menerio key working, then step 7 of `projects/menerio-one-key/plan.md` in the hub. |
