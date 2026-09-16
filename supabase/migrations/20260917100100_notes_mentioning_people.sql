-- "Related notes" on a person, found by the database instead of a client scan.
--
-- PersonDetail loaded the user's 50 newest notes and kept the ones whose
-- metadata.people named the person or one of their aliases. Any note about the
-- person older than the 50th note overall was never listed, so for anyone with
-- a real archive the section showed a handful of recent notes or "No related
-- notes found." while dozens existed.
--
-- The match stays exactly what the client did: case-insensitive equality of an
-- element of metadata.people with the name or an alias. PostgREST's `cs`
-- filter is case-sensitive, which is why this is a function and not a filter.
-- SECURITY INVOKER keeps RLS in force, with an explicit owner filter as defense
-- in depth, the same as search_contacts_page.

CREATE OR REPLACE FUNCTION public.notes_mentioning_people(
  p_names text[],
  p_limit integer DEFAULT 100
)
RETURNS TABLE (id uuid, title text, created_at timestamptz, metadata jsonb)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH wanted AS (
    SELECT DISTINCT lower(n) AS name
    FROM unnest(coalesce(p_names, ARRAY[]::text[])) AS n
    WHERE n IS NOT NULL AND n <> ''
  )
  SELECT nt.id, nt.title, nt.created_at, nt.metadata
  FROM public.notes nt
  WHERE nt.user_id = auth.uid()
    AND coalesce(nt.is_trashed, false) = false
    AND jsonb_typeof(nt.metadata -> 'people') = 'array'
    AND EXISTS (
      SELECT 1
      -- The CASE, not the WHERE above, is what keeps a non-array value from
      -- raising: SQL does not promise to evaluate the WHERE terms in order.
      FROM jsonb_array_elements_text(
        CASE WHEN jsonb_typeof(nt.metadata -> 'people') = 'array'
             THEN nt.metadata -> 'people' ELSE '[]'::jsonb END
      ) AS p(person)
      JOIN wanted w ON w.name = lower(p.person)
    )
  ORDER BY nt.created_at DESC, nt.id DESC
  LIMIT greatest(1, least(coalesce(p_limit, 100), 500));
$$;

COMMENT ON FUNCTION public.notes_mentioning_people(text[], integer) IS
  'The signed-in user''s untrashed notes whose metadata.people names any of the given names (case-insensitive), newest first. Backs "Related notes" on a person.';

REVOKE ALL ON FUNCTION public.notes_mentioning_people(text[], integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.notes_mentioning_people(text[], integer) TO authenticated;
