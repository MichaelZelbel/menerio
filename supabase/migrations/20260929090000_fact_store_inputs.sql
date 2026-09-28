-- Inputs of the fact store switch (docs/plans/one-fact-store.md, A3 and A6).
--
-- Two tables the switch migration reads. Neither holds anything that is not
-- already in the database: fact_label_map is written by the build-fact-label-map
-- edge function from the stored labels, and fact_unshown_drop holds only claim
-- ids. RLS is on with no policy, so only the service role and postgres see them.
-- Both are dropped in B6.

CREATE TABLE IF NOT EXISTS public.fact_label_map (
  kind          text NOT NULL CHECK (kind IN ('label','attribute')),
  key           text NOT NULL,
  attribute     text NOT NULL CHECK (attribute <> ''),
  label         text NOT NULL,
  category_slug text NOT NULL,
  PRIMARY KEY (kind, key)
);
ALTER TABLE public.fact_label_map ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.fact_label_map FROM anon, authenticated;

CREATE TABLE IF NOT EXISTS public.fact_unshown_drop (
  claim_id uuid PRIMARY KEY
);
ALTER TABLE public.fact_unshown_drop ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.fact_unshown_drop FROM anon, authenticated;
