-- 1. A single grouping function: gendered variants map onto their neutral bond.
CREATE OR REPLACE FUNCTION public.relationship_bond_group(p text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public'
AS $$
  SELECT coalesce((
    SELECT g.grp FROM (VALUES
      ('spouse','spouse'),('husband','spouse'),('wife','spouse'),
      ('parent','parent'),('father','parent'),('mother','parent'),
      ('child','child'),('son','child'),('daughter','child'),
      ('sibling','sibling'),('brother','sibling'),('sister','sibling'),
      ('grandparent','grandparent'),('grandfather','grandparent'),('grandmother','grandparent'),
      ('grandchild','grandchild'),('grandson','grandchild'),('granddaughter','grandchild'),
      ('pibling','pibling'),('aunt','pibling'),('uncle','pibling'),
      ('nibling','nibling'),('niece','nibling'),('nephew','nibling'),
      ('stepparent','stepparent'),('stepfather','stepparent'),('stepmother','stepparent'),
      ('stepchild','stepchild'),('stepson','stepchild'),('stepdaughter','stepchild'),
      ('stepsibling','stepsibling'),('stepbrother','stepsibling'),('stepsister','stepsibling'),
      ('parent-in-law','parent-in-law'),('father-in-law','parent-in-law'),('mother-in-law','parent-in-law'),
      ('child-in-law','child-in-law'),('son-in-law','child-in-law'),('daughter-in-law','child-in-law'),
      ('sibling-in-law','sibling-in-law'),('brother-in-law','sibling-in-law'),('sister-in-law','sibling-in-law'),
      ('godparent','godparent'),('godfather','godparent'),('godmother','godparent'),
      ('godchild','godchild'),('godson','godchild'),('goddaughter','godchild')
    ) AS g(lbl, grp)
    WHERE g.lbl = public.relationship_canonical_label(p)
    LIMIT 1
  ), public.relationship_canonical_label(p));
$$;

-- 2. Complete the inverse map so every family bond has its counterpart.
CREATE OR REPLACE FUNCTION public.relationship_inverse_label(p text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public'
AS $$
  SELECT CASE
    WHEN public.relationship_is_symmetric(p) THEN public.relationship_canonical_label(p)
    ELSE coalesce((
      SELECT m.inv FROM (VALUES
        ('wife','husband'),('husband','wife'),
        ('mother','child'),('father','child'),('parent','child'),
        ('child','parent'),('son','parent'),('daughter','parent'),
        ('brother','sibling'),('sister','sibling'),
        ('grandparent','grandchild'),('grandfather','grandchild'),('grandmother','grandchild'),
        ('grandchild','grandparent'),('grandson','grandparent'),('granddaughter','grandparent'),
        ('pibling','nibling'),('aunt','nibling'),('uncle','nibling'),
        ('nibling','pibling'),('niece','pibling'),('nephew','pibling'),
        ('stepparent','stepchild'),('stepfather','stepchild'),('stepmother','stepchild'),
        ('stepchild','stepparent'),('stepson','stepparent'),('stepdaughter','stepparent'),
        ('parent-in-law','child-in-law'),('father-in-law','child-in-law'),('mother-in-law','child-in-law'),
        ('child-in-law','parent-in-law'),('son-in-law','parent-in-law'),('daughter-in-law','parent-in-law'),
        ('godparent','godchild'),('godfather','godchild'),('godmother','godchild'),
        ('godchild','godparent'),('godson','godparent'),('goddaughter','godparent'),
        ('employer','employee'),('employee','employer'),
        ('manager','report'),('report','manager'),
        ('mentor','mentee'),('mentee','mentor'),
        ('teacher','student'),('student','teacher'),
        ('client','provider'),('provider','client')
      ) AS m(lbl, inv)
      WHERE m.lbl = public.relationship_canonical_label(p)
      LIMIT 1
    ), public.relationship_canonical_label(p))
  END;
$$;

-- 3. The pair key now works on bond groups on BOTH sides, so a gendered label
--    and its neutral twin, in either stored direction, produce one key.
CREATE OR REPLACE FUNCTION public.relationship_pair_key(p_user uuid, s_type text, s_id uuid, t_type text, t_id uuid, p_label text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path TO 'public'
AS $$
DECLARE c text; a text; b text; inv text; x text; y text;
BEGIN
  c := public.relationship_bond_group(p_label);
  a := s_type || ':' || coalesce(s_id::text, 'self');
  b := t_type || ':' || coalesce(t_id::text, 'self');
  IF public.relationship_is_symmetric(c) THEN
    RETURN p_user::text || '|sym|' || c || '|' || least(a, b) || '|' || greatest(a, b);
  END IF;
  inv := public.relationship_bond_group(public.relationship_inverse_label(c));
  x := a || ':' || c;
  y := b || ':' || inv;
  RETURN p_user::text || '|asym|' || least(x, y) || '|' || greatest(x, y);
END;
$$;

-- 4. Recompute every stored key with the corrected definition.
DROP INDEX IF EXISTS public.uq_contact_relationship_pair_key;

UPDATE public.contact_relationships
SET pair_key = public.relationship_pair_key(user_id, source_type, source_id, target_type, target_id, label);

-- 5. Collapse the duplicates this exposes across ALL accounts. The survivor is
--    the row a human vouched for, else the one carrying evidence, else the oldest.
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