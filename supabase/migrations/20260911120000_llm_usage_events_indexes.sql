-- Index the two columns every read of the ledger actually uses, and drop the one
-- no read has ever used.
--
-- Measured on production 2026-09-11, before this migration:
--   - `SELECT id ... WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1` ran
--     2,916 times at a 156 ms mean, reading all 20,295 rows every time. That is
--     540 seconds of database time since the 2026-08-21 stats reset, on a lookup
--     that belongs on an index.
--   - `idx_llm_usage_events_call_site` held 3,984 kB and had `idx_scan = 0`. Never
--     used once, maintained on every insert. Spend audits filter `created_at`
--     first and group by call_site second, so a created_at index serves them and
--     this one never wins.
--
-- The lookup that drove the user_id index is gone from the code as of 2026-09-07
-- (`deduct_ai_tokens_attributed` returns the event id inside the transaction).
-- The index stays regardless: RLS on this table is `user_id = auth.uid()`, so
-- every authenticated read filters on user_id whether the query says so or not.
--
-- Plain CREATE INDEX, not CONCURRENTLY: the table is 20k rows, the build is
-- instant, and CONCURRENTLY cannot run inside a migration's transaction.

DROP INDEX IF EXISTS public.idx_llm_usage_events_call_site;

CREATE INDEX IF NOT EXISTS llm_usage_events_user_created_idx
  ON public.llm_usage_events (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS llm_usage_events_created_idx
  ON public.llm_usage_events (created_at DESC);

COMMENT ON INDEX public.llm_usage_events_user_created_idx IS
  'Serves the RLS predicate (user_id = auth.uid()) plus the newest-first ordering every usage query uses. Added 2026-09-11.';
COMMENT ON INDEX public.llm_usage_events_created_idx IS
  'Serves date-ranged spend audits and the llm_spend_daily view. Added 2026-09-11, replacing the never-scanned call_site index.';
