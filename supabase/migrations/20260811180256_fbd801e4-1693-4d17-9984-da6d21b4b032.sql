CREATE OR REPLACE FUNCTION public.review_queue_relationship_block_reason(p_user_id uuid, p_payload jsonb)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  s_type text;
  t_type text;
  s_id uuid;
  t_id uuid;
  lbl text;
  new_key text;
  person_pair text;
BEGIN
  s_type := nullif(btrim(coalesce(p_payload->>'source_type', '')), '');
  t_type := nullif(btrim(coalesce(p_payload->>'target_type', '')), '');
  BEGIN
    s_id := nullif(p_payload->>'source_id', '')::uuid;
  EXCEPTION WHEN others THEN s_id := NULL;
  END;
  BEGIN
    t_id := nullif(p_payload->>'target_id', '')::uuid;
  EXCEPTION WHEN others THEN t_id := NULL;
  END;

  IF s_type IS NULL OR t_type IS NULL THEN
    RETURN 'incomplete_endpoints';
  END IF;
  IF s_type NOT IN ('self','contact') OR t_type NOT IN ('self','contact') THEN
    RETURN 'unsupported_endpoint_type';
  END IF;
  IF s_type = 'contact' AND s_id IS NULL THEN RETURN 'missing_source_contact'; END IF;
  IF t_type = 'contact' AND t_id IS NULL THEN RETURN 'missing_target_contact'; END IF;

  IF public.profile_integrity_relationship_pair(p_user_id, s_type, s_id, t_type, t_id) THEN
    RETURN 'self_relationship';
  END IF;

  IF s_type = 'contact' AND NOT EXISTS (
    SELECT 1 FROM public.contacts c WHERE c.id = s_id AND c.user_id = p_user_id
  ) THEN
    RETURN 'source_contact_missing';
  END IF;
  IF t_type = 'contact' AND NOT EXISTS (
    SELECT 1 FROM public.contacts c WHERE c.id = t_id AND c.user_id = p_user_id
  ) THEN
    RETURN 'target_contact_missing';
  END IF;

  lbl := public.relationship_canonical_label(coalesce(p_payload->>'label', ''));
  IF lbl IS NULL OR lbl = '' THEN RETURN 'missing_label'; END IF;
  IF public.profile_integrity_blocked_relationship_label(lbl) THEN RETURN 'blocked_label'; END IF;

  new_key := public.relationship_pair_key(p_user_id, s_type, s_id, t_type, t_id, lbl);
  person_pair := public.relationship_person_pair(p_user_id, s_type, s_id, t_type, t_id);

  IF EXISTS (SELECT 1 FROM public.contact_relationships cr WHERE cr.pair_key = new_key) THEN
    RETURN 'already_exists';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.relationship_rejections r
     WHERE r.user_id = p_user_id AND r.pair_key = new_key
  ) THEN
    RETURN 'previously_rejected';
  END IF;

  -- Directional contradiction: the same asymmetric role already exists for the
  -- same two people, but pointing the other way (e.g. "Gunther manages you"
  -- already recorded, and the suggestion claims "you manage Gunther").
  IF NOT public.relationship_is_symmetric(public.relationship_bond_group(lbl)) AND EXISTS (
    SELECT 1
      FROM public.contact_relationships cr
     WHERE cr.user_id = p_user_id
       AND public.relationship_person_pair(cr.user_id, cr.source_type, cr.source_id, cr.target_type, cr.target_id) = person_pair
       AND public.relationship_bond_group(cr.label) = public.relationship_bond_group(lbl)
       AND cr.pair_key IS DISTINCT FROM new_key
  ) THEN
    RETURN 'contradicts_existing_direction';
  END IF;

  RETURN NULL;
END;
$function$;

CREATE OR REPLACE FUNCTION public.review_queue_appliability_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE reason text;
BEGIN
  IF NEW.suggestion_type = 'add_relationship'
     AND coalesce(NEW.status, 'pending_review') IN ('pending', 'pending_review') THEN
    reason := public.review_queue_relationship_block_reason(NEW.user_id, coalesce(NEW.payload, '{}'::jsonb));
    IF reason IS NOT NULL THEN
      NEW.status := 'blocked';
      NEW.blocked_at := now();
      NEW.payload := coalesce(NEW.payload, '{}'::jsonb) || jsonb_build_object('block_reason', reason);
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_review_queue_appliability_guard ON public.review_queue;
CREATE TRIGGER trg_review_queue_appliability_guard
BEFORE INSERT ON public.review_queue
FOR EACH ROW EXECUTE FUNCTION public.review_queue_appliability_guard();

UPDATE public.review_queue rq
   SET status = 'blocked',
       blocked_at = now(),
       payload = coalesce(rq.payload, '{}'::jsonb)
         || jsonb_build_object('block_reason', public.review_queue_relationship_block_reason(rq.user_id, coalesce(rq.payload, '{}'::jsonb)))
 WHERE rq.suggestion_type = 'add_relationship'
   AND rq.status IN ('pending', 'pending_review')
   AND public.review_queue_relationship_block_reason(rq.user_id, coalesce(rq.payload, '{}'::jsonb)) IS NOT NULL;