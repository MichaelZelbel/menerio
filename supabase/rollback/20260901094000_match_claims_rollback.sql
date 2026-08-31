-- Rollback for 20260901094000_match_claims.sql
--
-- ORDER. Run these four in descending number, the reverse of the order they
-- were applied. This one is FOURTH of the four added on 2026-09-01:
--
--   1. 20260901097000_..._rollback.sql   (world_claims stops hiding promoted entries)
--   2. 20260901096000_..._rollback.sql   (match_claims stops asking the user's day)
--   3. 20260901095000_..._rollback.sql   (HNSW index back to ivfflat)
--   4. 20260901094000_..._rollback.sql   ← you are here
--   then 093000, 092000, 091000, 090000 as their own headers describe.
--
-- Running this before 096000's rollback is harmless but pointless: this drops
-- the function that one rebuilds. Running it before 095000's rollback leaves
-- an index on a column that no longer exists — Postgres drops the index with
-- the column, so 095000's rollback then fails to find it and does nothing.
-- Descending order avoids both.
--
-- WHAT THIS COSTS. Dropping the embedding column destroys every claim
-- embedding. No claim, value, date or quote is touched, but claims become
-- unsearchable by meaning and `search_brain` loses its claims arm entirely,
-- as does the in-app assistant's `search_claims` tool. The vectors are
-- recoverable: re-running the migration and then the `backfill-claim-embeddings`
-- edge function rebuilds them, at one embedding API call per claim.
--
-- DEPLOY THE CODE FIRST. menerio-mcp and the chat functions (via
-- _shared/read-tools.ts) both call match_claims. Roll those back to a build
-- that does not, or they will log an RPC error on every search. They fail
-- soft — the claims arm returns [] and notes still answer — so this is a
-- degradation, not an outage.

DROP FUNCTION IF EXISTS public.match_claims(
  extensions.vector, double precision, integer, uuid, date
);

-- Named for whichever of the two index shapes is actually present: ivfflat if
-- 095000's rollback has already run, HNSW if it has not.
DROP INDEX IF EXISTS public.claims_embedding_idx;
DROP INDEX IF EXISTS public.claims_embedding_hnsw_idx;

ALTER TABLE public.claims
  DROP COLUMN IF EXISTS embedding;
