UPDATE public.contacts
SET tags = COALESCE(
  (
    SELECT array_agg(tag)
    FROM unnest(tags) AS tag
    WHERE lower(tag) <> 'temerio-import'
  ),
  ARRAY[]::text[]
)
WHERE EXISTS (
  SELECT 1
  FROM unnest(tags) AS tag
  WHERE lower(tag) = 'temerio-import'
);