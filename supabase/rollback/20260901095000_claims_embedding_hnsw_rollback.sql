-- Rollback for 20260901095000_claims_embedding_hnsw.sql
--
-- ORDER. THIRD of the four 2026-09-01 rollbacks, run in descending number:
-- 097000, then 096000, then this, then 094000. It must run BEFORE 094000's
-- rollback, which drops claims.embedding and takes any index on it along.
-- Running it after that leaves nothing to restore and the CREATE INDEX below
-- fails on a missing column.
--
-- READ THIS BEFORE RUNNING IT. This restores an index that was measured
-- broken. ivfflat probes one of `lists` clusters per query; with lists = 100
-- over a table of this size nearly every list is empty, so a query returns
-- almost nothing. It was proved on 2026-08-31 by calling match_claims with a
-- row's OWN embedding: it should return at similarity 1.0 and did not come
-- back at all, while an unrelated row came back at 0.045.
--
-- The failure is silent and gets worse the emptier the table. Nothing errors.
-- Search finds nothing and every caller — the MCP, the in-app assistant, the
-- hub mirror — concludes the facts were never saved.
--
-- So run this only to reach a known prior state (a bisect, or a pg_dump taken
-- before the swap). If the reason is "HNSW is too slow to build" or "HNSW uses
-- too much memory", drop the index entirely instead and let the planner scan:
--
--   DROP INDEX IF EXISTS public.claims_embedding_hnsw_idx;
--
-- An exact sequential scan over a few thousand vectors is correct and fast
-- enough, where a probing index that misses is neither.

DROP INDEX IF EXISTS public.claims_embedding_hnsw_idx;

CREATE INDEX IF NOT EXISTS claims_embedding_idx
  ON public.claims USING ivfflat (embedding extensions.vector_cosine_ops)
  WITH (lists = 100);
