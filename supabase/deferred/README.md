# Deferred migrations

SQL in this folder is written but **not yet applied**. It is deliberately outside
`supabase/migrations/`, because everything in that folder runs on the next deploy and
these statements are meant to wait.

Moving a file from here into `supabase/migrations/` (keeping the timestamp prefix in
order) is what schedules it for the next deploy.

Nothing is waiting here at the moment.

The last file that waited here, `revoke-legacy-mcp-token.sql` (step 7 of "One key for
Menerio"), was moved into `supabase/migrations/` on 2026-08-17 as
`20260817150004_7c41d9be-5a02-4f13-9b6e-2d8af3061c77.sql`. A second copy of it with the
same statements, `20260922051204_67281ae7-94df-4c51-8b65-70b2c0dbd302.sql`, was added by
Lovable on 2026-09-22. Both still carry the old header saying they are not in
`supabase/migrations/`. Both raise an exception on a database that never held the old
token, so neither can be replayed on a fresh database.
