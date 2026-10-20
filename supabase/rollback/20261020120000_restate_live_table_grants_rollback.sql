-- Rollback for 20261020120000_restate_live_table_grants.
--
-- That migration restates the live ACLs of 2026-10-20 (saved next to this file
-- as 20261020120000_live_acl_snapshot.json) and was applied to live on
-- 2026-10-20 with the before and after snapshots byte-identical, so there is
-- no privilege change to undo. To force the ACLs back to that snapshot, re-run
-- the migration itself (it is generated from it by
-- scripts/oneoff/generate-grant-catch-up.mjs). This file only removes the
-- record.
delete from supabase_migrations.schema_migrations where version = '20261020120000';
