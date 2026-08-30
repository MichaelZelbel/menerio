-- Replace the claims ivfflat index with HNSW.
--
-- WHY (found by testing, 2026-08-31): ivfflat splits the vectors into `lists`
-- clusters and probes only one of them per query. With lists = 100 and three
-- rows in the table, essentially every list is empty, so a query returns
-- almost nothing. Proved by calling match_claims with a row's OWN embedding:
-- it should come back at similarity 1.0 and instead did not come back at all,
-- while an unrelated row came back at 0.045.
--
-- That failure mode is silent and it gets WORSE the emptier the table, which
-- is exactly the state a new feature ships in. Nothing errors; search simply
-- finds nothing and every caller concludes the data is missing.
--
-- HNSW has no equivalent cliff: it is a navigable graph rather than a
-- clustering, so recall stays high from the first row. It costs more to build
-- and more memory, which is irrelevant at this size and acceptable later.
--
-- ivfflat also cannot be built usefully before the data exists, since its
-- clusters are trained on the rows present at CREATE INDEX time. For a table
-- that starts empty and fills up, that is the wrong tool by construction.

DROP INDEX IF EXISTS public.claims_embedding_idx;

CREATE INDEX IF NOT EXISTS claims_embedding_hnsw_idx
  ON public.claims USING hnsw (embedding extensions.vector_cosine_ops);
