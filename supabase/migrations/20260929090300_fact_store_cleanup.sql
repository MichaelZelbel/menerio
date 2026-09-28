-- One fact store, clean-up (docs/plans/one-fact-store.md, B6). Applied right
-- after the one-time bag split, in the go-live sitting.
--
-- Drops the switch's one-off inputs and helper, and checks the origin
-- constraint now that no unknown origin can be written (0 violations in A6).

DROP FUNCTION IF EXISTS public.split_legacy_bag(uuid, uuid, jsonb);
DROP TABLE IF EXISTS public.fact_label_map;
DROP TABLE IF EXISTS public.fact_unshown_drop;
ALTER TABLE public.claims VALIDATE CONSTRAINT claims_origin_known;
