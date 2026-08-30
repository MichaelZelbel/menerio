-- Backfill cardinality and review_by onto claims written before the registry
-- existed, from public.attribute_rules.
--
-- Idempotent: re-running changes nothing once the values agree. Touches no
-- value, no date and no claim's existence; only the two new metadata columns.

UPDATE public.claims c
SET cardinality = ar.cardinality
FROM public.attribute_rules ar
WHERE ar.attribute = lower(regexp_replace(btrim(c.attribute), '\s+', '-', 'g'))
  AND c.cardinality IS DISTINCT FROM ar.cardinality;

-- review_by needs a start date to count from. A claim with no valid_from has
-- no anchor, so it stays NULL rather than being given an invented one: an
-- undated fact with a confident review date is worse than an undated fact.
UPDATE public.claims c
SET review_by = (c.valid_from + (ar.review_days || ' days')::interval)::date
FROM public.attribute_rules ar
WHERE ar.attribute = lower(regexp_replace(btrim(c.attribute), '\s+', '-', 'g'))
  AND ar.review_days IS NOT NULL
  AND c.valid_from IS NOT NULL
  AND c.review_by IS NULL;
