
-- 1) De-dupe existing symmetric relationships (keep oldest, delete later opposite-direction copies).
-- This deletes one of the Rick↔Xihui lover rows specifically, and any equivalent dupes for other users.
WITH canon AS (
  SELECT
    cr.id,
    cr.user_id,
    cr.created_at,
    cr.label,
    -- Canonical pair key for symmetric labels (direction-independent)
    CASE
      WHEN lower(cr.label) IN ('spouse','partner','lover','friend','sibling','co-worker','neighbor','roommate')
      THEN cr.user_id::text
        || '|sym|' || lower(cr.label) || '|'
        || LEAST(cr.source_type || ':' || COALESCE(cr.source_id::text,'self'),
                 cr.target_type || ':' || COALESCE(cr.target_id::text,'self'))
        || '|'
        || GREATEST(cr.source_type || ':' || COALESCE(cr.source_id::text,'self'),
                    cr.target_type || ':' || COALESCE(cr.target_id::text,'self'))
      ELSE NULL
    END AS sym_key
  FROM public.contact_relationships cr
),
ranked AS (
  SELECT id, sym_key, created_at,
         ROW_NUMBER() OVER (PARTITION BY sym_key ORDER BY created_at ASC, id ASC) AS rn
  FROM canon
  WHERE sym_key IS NOT NULL
)
DELETE FROM public.contact_relationships
WHERE id IN (SELECT id FROM ranked WHERE rn > 1);

-- 2) Replace direction-aware unique index with direction-aware-for-asymmetric +
--    direction-independent-for-symmetric uniqueness.
DROP INDEX IF EXISTS uq_contact_relationship;

-- Asymmetric labels: keep exact-direction uniqueness as before.
CREATE UNIQUE INDEX uq_contact_relationship_asym
  ON public.contact_relationships (
    user_id,
    source_type,
    COALESCE(source_id, '00000000-0000-0000-0000-000000000000'),
    target_type,
    COALESCE(target_id, '00000000-0000-0000-0000-000000000000'),
    label
  )
  WHERE lower(label) NOT IN ('spouse','partner','lover','friend','sibling','co-worker','neighbor','roommate');

-- Symmetric labels: direction-independent uniqueness using LEAST/GREATEST.
CREATE UNIQUE INDEX uq_contact_relationship_sym
  ON public.contact_relationships (
    user_id,
    lower(label),
    LEAST(source_type || ':' || COALESCE(source_id::text,'self'),
          target_type || ':' || COALESCE(target_id::text,'self')),
    GREATEST(source_type || ':' || COALESCE(source_id::text,'self'),
             target_type || ':' || COALESCE(target_id::text,'self'))
  )
  WHERE lower(label) IN ('spouse','partner','lover','friend','sibling','co-worker','neighbor','roommate');

-- 3) Add the missing self↔Xihui spouse relationship (only for Michael's user,
-- and only if no equivalent symmetric row already exists).
INSERT INTO public.contact_relationships (user_id, source_type, source_id, target_type, target_id, label)
SELECT '4332607c-1ddd-4a5d-8765-a44963e4fe12'::uuid,
       'self', NULL,
       'contact', '7d18d2a4-a65b-4cba-b90b-4edcd2044cdd'::uuid,
       'spouse'
WHERE NOT EXISTS (
  SELECT 1 FROM public.contact_relationships cr
  WHERE cr.user_id = '4332607c-1ddd-4a5d-8765-a44963e4fe12'::uuid
    AND lower(cr.label) = 'spouse'
    AND (
      (cr.source_type='self' AND cr.target_type='contact' AND cr.target_id='7d18d2a4-a65b-4cba-b90b-4edcd2044cdd'::uuid)
      OR
      (cr.target_type='self' AND cr.source_type='contact' AND cr.source_id='7d18d2a4-a65b-4cba-b90b-4edcd2044cdd'::uuid)
    )
);
