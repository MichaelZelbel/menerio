CREATE OR REPLACE FUNCTION public.profile_integrity_blocked_relationship_label(p_label text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT lower(trim(coalesce(p_label, ''))) IN (
    'subject of notes', 'protector', 'protectee', 'admirer', 'owner',
    'roleplay character', 'mentioned with', 'mentioned person', 'person mentioned',
    'financial advisor of self', 'self'
  )
  OR lower(trim(coalesce(p_label, ''))) ~ '^(subject|character|person) of notes?$';
$$;

CREATE OR REPLACE FUNCTION public.profile_integrity_relationship_pair(
  p_user_id uuid,
  p_source_type text,
  p_source_id uuid,
  p_target_type text,
  p_target_id uuid
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT p_source_type = p_target_type
    AND p_source_id IS NOT NULL
    AND p_source_id = p_target_id
  OR p_source_type = 'self' AND p_target_type = 'self';
$$;

CREATE OR REPLACE FUNCTION public.relationship_dedup_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  normalized_label text;
  new_pair_key text;
  existing_id uuid;
  existing_label text;
  existing_strength integer;
  new_strength integer;
BEGIN
  normalized_label := public.relationship_canonical_label(NEW.label);
  IF normalized_label IS NULL OR normalized_label = '' THEN
    RETURN NULL;
  END IF;

  IF public.profile_integrity_blocked_relationship_label(normalized_label)
     OR public.profile_integrity_relationship_pair(
       NEW.user_id, NEW.source_type, NEW.source_id,
       NEW.target_type, NEW.target_id
     ) THEN
    RETURN NULL;
  END IF;

  NEW.label := normalized_label;
  NEW.custom_label := NULLIF(trim(coalesce(NEW.custom_label, '')), '');
  new_pair_key := public.relationship_pair_key(
    NEW.user_id,
    NEW.source_type, NEW.source_id,
    NEW.target_type, NEW.target_id,
    NEW.label
  );
  NEW.pair_key := new_pair_key;

  SELECT cr.id, cr.label
    INTO existing_id, existing_label
    FROM public.contact_relationships cr
   WHERE cr.pair_key = new_pair_key
     AND (TG_OP = 'INSERT' OR cr.id <> NEW.id)
   LIMIT 1;

  IF existing_id IS NOT NULL THEN
    RETURN NULL;
  END IF;

  -- A generic parent/child role must not sit beside a more specific role for
  -- the same pair. This is semantic specificity, not romantic cardinality.
  IF NEW.label IN ('parent', 'child') THEN
    IF EXISTS (
      SELECT 1
        FROM public.contact_relationships cr
       WHERE cr.user_id = NEW.user_id
         AND public.relationship_person_pair(
           cr.user_id, cr.source_type, cr.source_id,
           cr.target_type, cr.target_id
         ) = public.relationship_person_pair(
           NEW.user_id, NEW.source_type, NEW.source_id,
           NEW.target_type, NEW.target_id
         )
         AND cr.label IN ('mother', 'father', 'son', 'daughter')
         AND (TG_OP = 'INSERT' OR cr.id <> NEW.id)
    ) THEN
      RETURN NULL;
    END IF;
  ELSE
    DELETE FROM public.contact_relationships cr
     WHERE cr.user_id = NEW.user_id
       AND public.relationship_person_pair(
         cr.user_id, cr.source_type, cr.source_id,
         cr.target_type, cr.target_id
       ) = public.relationship_person_pair(
         NEW.user_id, NEW.source_type, NEW.source_id,
         NEW.target_type, NEW.target_id
       )
       AND cr.label IN ('parent', 'child')
       AND (TG_OP = 'INSERT' OR cr.id <> NEW.id);
  END IF;

  IF public.relationship_is_bond(NEW.label) THEN
    new_strength := public.relationship_strength(NEW.label);
    SELECT max(public.relationship_strength(cr.label))
      INTO existing_strength
      FROM public.contact_relationships cr
     WHERE cr.user_id = NEW.user_id
       AND public.relationship_person_pair(
         cr.user_id, cr.source_type, cr.source_id,
         cr.target_type, cr.target_id
       ) = public.relationship_person_pair(
         NEW.user_id, NEW.source_type, NEW.source_id,
         NEW.target_type, NEW.target_id
       )
       AND cr.label <> NEW.label
       AND (TG_OP = 'INSERT' OR cr.id <> NEW.id);

    IF coalesce(existing_strength, -1) >= new_strength THEN
      RETURN NULL;
    END IF;

    DELETE FROM public.contact_relationships cr
     WHERE cr.user_id = NEW.user_id
       AND public.relationship_person_pair(
         cr.user_id, cr.source_type, cr.source_id,
         cr.target_type, cr.target_id
       ) = public.relationship_person_pair(
         NEW.user_id, NEW.source_type, NEW.source_id,
         NEW.target_type, NEW.target_id
       )
       AND public.relationship_is_bond(cr.label)
       AND public.relationship_strength(cr.label) < new_strength
       AND (TG_OP = 'INSERT' OR cr.id <> NEW.id);
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_contact_relationships_dedup ON public.contact_relationships;
CREATE TRIGGER trg_contact_relationships_dedup
BEFORE INSERT OR UPDATE ON public.contact_relationships
FOR EACH ROW EXECUTE FUNCTION public.relationship_dedup_guard();

CREATE OR REPLACE FUNCTION public.profile_entry_quality_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  label_key text := lower(trim(coalesce(NEW.label, '')));
  value_key text := lower(trim(coalesce(NEW.value, '')));
BEGIN
  IF label_key = '' OR value_key = '' THEN
    RETURN NULL;
  END IF;

  IF value_key IN ('none', 'n/a', 'na', 'unknown', 'unspecified', '-', '—', 'null')
     OR value_key = label_key
     OR value_key ~ '^(none|n/?a|unknown|unspecified)\s*[.!]?$'
     OR label_key IN (
       'purchased item', 'purchased items', 'purchase', 'purchases',
       'order', 'orders', 'recent order', 'subject of notes',
       'roleplay character', 'mentioned with'
     ) THEN
    RETURN NULL;
  END IF;

  NEW.label := trim(NEW.label);
  NEW.value := trim(NEW.value);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_profile_entries_quality_guard ON public.profile_entries;
CREATE TRIGGER trg_profile_entries_quality_guard
BEFORE INSERT OR UPDATE ON public.profile_entries
FOR EACH ROW EXECUTE FUNCTION public.profile_entry_quality_guard();

REVOKE EXECUTE ON FUNCTION public.profile_integrity_blocked_relationship_label(text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.profile_integrity_relationship_pair(uuid, text, uuid, text, uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.profile_entry_quality_guard() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.relationship_dedup_guard() FROM PUBLIC, anon, authenticated;