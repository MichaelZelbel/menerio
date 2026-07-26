-- 1) Canonicalization helpers (SQL mirror of _shared/relationship-canonical.ts)

CREATE OR REPLACE FUNCTION public.relationship_normalize_label(p text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT nullif(btrim(
    regexp_replace(
      regexp_replace(
        regexp_replace(
          regexp_replace(lower(coalesce(p, '')), '\([^)]*\)', ' ', 'g'),
        '[/|,]+', ' / ', 'g'),
      '[^a-z0-9/[:space:]-]+', ' ', 'g'),
    '\s+', ' ', 'g')
  ), '');
$$;

CREATE OR REPLACE FUNCTION public.relationship_label_map(p_key text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT m.canon FROM (VALUES
    ('wife','wife'),('husband','husband'),('spouse','spouse'),('married','spouse'),
    ('married to','spouse'),('marriage','spouse'),('life partner','spouse'),
    ('ehefrau','wife'),('ehemann','husband'),('ehepartner','spouse'),
    ('partner','partner'),('girlfriend','partner'),('boyfriend','partner'),
    ('fiance','partner'),('fiancee','partner'),
    ('romantic partner','partner'),('intimate partner','partner'),
    ('sexual partner','partner'),('romantic interest','partner'),
    ('love interest','partner'),('companion','partner'),
    ('significant other','partner'),('freundin','partner'),('freund','partner'),
    ('lover','lover'),
    ('mom','mother'),('mum','mother'),('mama','mother'),('mutter','mother'),('mother','mother'),
    ('dad','father'),('papa','father'),('vater','father'),('father','father'),
    ('parent','parent'),('child','child'),('kid','child'),('kids','child'),('children','child'),
    ('son','son'),('daughter','daughter'),
    ('brother','brother'),('bruder','brother'),('sister','sister'),('schwester','sister'),
    ('sibling','sibling'),
    ('friend','friend'),('friends','friend'),('bestfriend','friend'),('best friend','friend'),
    ('buddy','friend'),('pal','friend'),('acquaintance','friend'),
    ('friend / colleague','friend'),('friend / co-worker','friend'),
    ('friend or colleague','friend'),('friend or co-worker','friend'),
    ('neighbor','neighbor'),('neighbour','neighbor'),
    ('roommate','roommate'),('flatmate','roommate'),
    ('coworker','co-worker'),('co-worker','co-worker'),('co worker','co-worker'),
    ('colleague','co-worker'),('team member','co-worker'),('teammate','co-worker'),
    ('collaborator','co-worker'),('work contact','co-worker'),
    ('manager','manager'),('line manager','manager'),('reporting manager','manager'),
    ('reports to','manager'),('manager or coordinator','manager'),('coordinator','manager'),
    ('boss','manager'),('supervisor','manager'),
    ('report','report'),('direct report','report'),('manages','report'),
    ('employee','employee'),('employer','employer'),
    ('mentor','mentor'),('mentee','mentee'),
    ('teacher','teacher'),('student','student'),
    ('client','client'),('provider','provider')
  ) AS m(alias, canon)
  WHERE m.alias = p_key
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.relationship_canonical_label(p text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  WITH k AS (SELECT public.relationship_normalize_label(p) AS key)
  SELECT coalesce(
    public.relationship_label_map((SELECT key FROM k)),
    CASE WHEN (SELECT key FROM k) LIKE '% / %'
      THEN public.relationship_label_map(split_part((SELECT key FROM k), ' / ', 1))
    END,
    (SELECT key FROM k)
  );
$$;

CREATE OR REPLACE FUNCTION public.relationship_is_symmetric(p text)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT public.relationship_canonical_label(p) IN
    ('spouse','partner','lover','friend','sibling','co-worker','neighbor','roommate');
$$;

CREATE OR REPLACE FUNCTION public.relationship_inverse_label(p text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT CASE
    WHEN public.relationship_is_symmetric(p) THEN public.relationship_canonical_label(p)
    ELSE coalesce((
      SELECT m.inv FROM (VALUES
        ('wife','husband'),('husband','wife'),
        ('mother','child'),('father','child'),('parent','child'),
        ('child','parent'),('son','parent'),('daughter','parent'),
        ('brother','sibling'),('sister','sibling'),
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

CREATE OR REPLACE FUNCTION public.relationship_strength(p text)
RETURNS int LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT CASE public.relationship_canonical_label(p)
    WHEN 'spouse' THEN 100 WHEN 'husband' THEN 100 WHEN 'wife' THEN 100
    WHEN 'partner' THEN 90
    WHEN 'lover' THEN 80
    WHEN 'friend' THEN 10
    ELSE 50 END;
$$;

CREATE OR REPLACE FUNCTION public.relationship_is_bond(p text)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT public.relationship_canonical_label(p)
    IN ('spouse','husband','wife','partner','lover','friend');
$$;

CREATE OR REPLACE FUNCTION public.relationship_person_pair(
  p_user uuid, s_type text, s_id uuid, t_type text, t_id uuid
) RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT p_user::text || '|' ||
    least(s_type || ':' || coalesce(s_id::text, 'self'), t_type || ':' || coalesce(t_id::text, 'self')) || '|' ||
    greatest(s_type || ':' || coalesce(s_id::text, 'self'), t_type || ':' || coalesce(t_id::text, 'self'));
$$;

CREATE OR REPLACE FUNCTION public.relationship_pair_key(
  p_user uuid, s_type text, s_id uuid, t_type text, t_id uuid, p_label text
) RETURNS text LANGUAGE plpgsql IMMUTABLE SET search_path = public AS $$
DECLARE c text; a text; b text; inv text; x text; y text;
BEGIN
  c := public.relationship_canonical_label(p_label);
  IF c IN ('husband','wife') THEN c := 'spouse'; END IF;
  a := s_type || ':' || coalesce(s_id::text, 'self');
  b := t_type || ':' || coalesce(t_id::text, 'self');
  IF c IN ('spouse','partner','lover','friend','sibling','co-worker','neighbor','roommate') THEN
    RETURN p_user::text || '|sym|' || c || '|' || least(a, b) || '|' || greatest(a, b);
  END IF;
  inv := public.relationship_inverse_label(c);
  x := a || ':' || c;
  y := b || ':' || inv;
  RETURN p_user::text || '|asym|' || least(x, y) || '|' || greatest(x, y);
END;
$$;

-- 2) Pair key column
ALTER TABLE public.contact_relationships ADD COLUMN IF NOT EXISTS pair_key text;

-- 2b) Retire the older, label-literal uniqueness indexes; the pair key below
--     supersedes them and they would block canonicalization.
DROP INDEX IF EXISTS public.uq_contact_relationship_sym;
DROP INDEX IF EXISTS public.uq_contact_relationship_asym;

-- 3) Canonicalize existing labels
UPDATE public.contact_relationships
SET label = coalesce(nullif(public.relationship_canonical_label(label), ''), label)
WHERE label IS DISTINCT FROM coalesce(nullif(public.relationship_canonical_label(label), ''), label);

-- 4) Collapse exact duplicate bonds (same pair key), keeping the oldest row
WITH keyed AS (
  SELECT id, created_at,
    public.relationship_pair_key(user_id, source_type, source_id, target_type, target_id, label) AS k
  FROM public.contact_relationships
), ranked AS (
  SELECT id, row_number() OVER (PARTITION BY k ORDER BY created_at, id) AS rn FROM keyed
)
DELETE FROM public.contact_relationships r
USING ranked WHERE r.id = ranked.id AND ranked.rn > 1;

-- 5) Collapse competing romantic/social bonds between the same two people:
--    strongest claim wins (married > partner > lover > friend)
WITH bonds AS (
  SELECT id, created_at,
    public.relationship_person_pair(user_id, source_type, source_id, target_type, target_id) AS pair,
    public.relationship_strength(label) AS strength
  FROM public.contact_relationships
  WHERE public.relationship_is_bond(label)
), ranked AS (
  SELECT id, row_number() OVER (PARTITION BY pair ORDER BY strength DESC, created_at, id) AS rn FROM bonds
)
DELETE FROM public.contact_relationships r
USING ranked WHERE r.id = ranked.id AND ranked.rn > 1;

-- 6) Backfill keys + enforce uniqueness
UPDATE public.contact_relationships
SET pair_key = public.relationship_pair_key(user_id, source_type, source_id, target_type, target_id, label)
WHERE pair_key IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_contact_relationship_pair_key
  ON public.contact_relationships (pair_key);

-- 7) Guard every future write
CREATE OR REPLACE FUNCTION public.relationship_dedup_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_pair text; v_strength int; v_max int;
BEGIN
  NEW.label := coalesce(nullif(public.relationship_canonical_label(NEW.label), ''), NEW.label);
  IF NEW.custom_label IS NOT NULL THEN
    NEW.custom_label := nullif(btrim(NEW.custom_label), '');
  END IF;
  NEW.pair_key := public.relationship_pair_key(
    NEW.user_id, NEW.source_type, NEW.source_id, NEW.target_type, NEW.target_id, NEW.label);

  IF EXISTS (
    SELECT 1 FROM public.contact_relationships r
    WHERE r.pair_key = NEW.pair_key AND r.id IS DISTINCT FROM NEW.id
  ) THEN
    RETURN NULL; -- equivalent edge already recorded; silently ignore
  END IF;

  IF public.relationship_is_bond(NEW.label) THEN
    v_pair := public.relationship_person_pair(
      NEW.user_id, NEW.source_type, NEW.source_id, NEW.target_type, NEW.target_id);
    v_strength := public.relationship_strength(NEW.label);

    SELECT max(public.relationship_strength(r.label)) INTO v_max
    FROM public.contact_relationships r
    WHERE r.user_id = NEW.user_id
      AND r.id IS DISTINCT FROM NEW.id
      AND public.relationship_is_bond(r.label)
      AND public.relationship_person_pair(
            r.user_id, r.source_type, r.source_id, r.target_type, r.target_id) = v_pair;

    IF v_max IS NOT NULL AND v_max >= v_strength THEN
      RETURN NULL; -- a stronger or equal bond already exists for this pair
    END IF;

    DELETE FROM public.contact_relationships r
    WHERE r.user_id = NEW.user_id
      AND r.id IS DISTINCT FROM NEW.id
      AND public.relationship_is_bond(r.label)
      AND public.relationship_person_pair(
            r.user_id, r.source_type, r.source_id, r.target_type, r.target_id) = v_pair;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_contact_relationships_dedup ON public.contact_relationships;
CREATE TRIGGER trg_contact_relationships_dedup
BEFORE INSERT OR UPDATE ON public.contact_relationships
FOR EACH ROW EXECUTE FUNCTION public.relationship_dedup_guard();