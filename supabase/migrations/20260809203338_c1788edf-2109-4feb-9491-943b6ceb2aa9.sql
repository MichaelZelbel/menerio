DROP INDEX IF EXISTS public.uq_contact_relationship_pair_key;

UPDATE public.contact_relationships
SET pair_key = public.relationship_pair_key(user_id, source_type, source_id, target_type, target_id, label);

WITH ranked AS (
  SELECT id, pair_key,
         row_number() OVER (
           PARTITION BY pair_key
           ORDER BY
             CASE WHEN origin = 'user_manual' THEN 0 ELSE 1 END,
             CASE WHEN coalesce(length(evidence_quote), 0) >= 10 THEN 0 ELSE 1 END,
             created_at ASC
         ) AS rn
  FROM public.contact_relationships
)
DELETE FROM public.contact_relationships cr
USING ranked r
WHERE cr.id = r.id AND r.rn > 1;

CREATE UNIQUE INDEX uq_contact_relationship_pair_key
  ON public.contact_relationships USING btree (pair_key);