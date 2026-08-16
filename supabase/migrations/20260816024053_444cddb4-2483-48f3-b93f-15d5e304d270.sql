
CREATE TABLE public.profile_audit_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  contact_id uuid REFERENCES public.contacts(id) ON DELETE CASCADE,
  contact_key uuid GENERATED ALWAYS AS (COALESCE(contact_id, '00000000-0000-0000-0000-000000000000'::uuid)) STORED,
  status text NOT NULL DEFAULT 'dirty',
  rounds integer NOT NULL DEFAULT 0,
  merged_count integer NOT NULL DEFAULT 0,
  entry_count integer NOT NULL DEFAULT 0,
  findings jsonb NOT NULL DEFAULT '[]'::jsonb,
  last_error text,
  dirty_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX profile_audit_runs_scope_key
  ON public.profile_audit_runs (user_id, contact_key);
CREATE INDEX profile_audit_runs_status_idx
  ON public.profile_audit_runs (status, dirty_at);

GRANT SELECT ON public.profile_audit_runs TO authenticated;
GRANT ALL ON public.profile_audit_runs TO service_role;
ALTER TABLE public.profile_audit_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view their own profile audit runs"
  ON public.profile_audit_runs FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE TABLE public.profile_audit_merges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid REFERENCES public.profile_audit_runs(id) ON DELETE SET NULL,
  user_id uuid NOT NULL,
  contact_id uuid,
  kept_entry_id uuid,
  kept_label text,
  kept_value text,
  removed jsonb NOT NULL DEFAULT '[]'::jsonb,
  reason text,
  rolled_back_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX profile_audit_merges_scope_idx
  ON public.profile_audit_merges (user_id, contact_id, created_at DESC);

GRANT SELECT ON public.profile_audit_merges TO authenticated;
GRANT ALL ON public.profile_audit_merges TO service_role;
ALTER TABLE public.profile_audit_merges ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view their own profile audit merges"
  ON public.profile_audit_merges FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE OR REPLACE FUNCTION public.profile_audit_mark_dirty(_user_id uuid, _contact_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profile_audit_runs (user_id, contact_id, status, dirty_at, updated_at)
  VALUES (_user_id, _contact_id, 'dirty', now(), now())
  ON CONFLICT (user_id, contact_key) DO UPDATE
    SET status = 'dirty',
        dirty_at = now(),
        updated_at = now();
END;
$$;

CREATE OR REPLACE FUNCTION public.profile_entries_mark_audit_dirty()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row record;
BEGIN
  IF current_setting('menerio.profile_audit', true) = 'on' THEN
    RETURN NULL;
  END IF;
  IF TG_OP = 'DELETE' THEN
    v_row := OLD;
  ELSE
    v_row := NEW;
  END IF;
  PERFORM public.profile_audit_mark_dirty(v_row.user_id, v_row.contact_id);
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_profile_entries_mark_audit_dirty ON public.profile_entries;
CREATE TRIGGER trg_profile_entries_mark_audit_dirty
  AFTER INSERT OR UPDATE OR DELETE ON public.profile_entries
  FOR EACH ROW EXECUTE FUNCTION public.profile_entries_mark_audit_dirty();

CREATE OR REPLACE FUNCTION public.profile_audit_apply_merge(
  _run_id uuid,
  _keep_id uuid,
  _remove_ids uuid[],
  _label text,
  _value text,
  _reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_keep record;
  v_removed jsonb;
  v_ids uuid[];
  v_merge_id uuid;
BEGIN
  SELECT * INTO v_keep FROM public.profile_entries WHERE id = _keep_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('applied', false, 'reason', 'keep_missing');
  END IF;

  SELECT COALESCE(jsonb_agg(to_jsonb(pe)), '[]'::jsonb),
         COALESCE(array_agg(pe.id), ARRAY[]::uuid[])
    INTO v_removed, v_ids
    FROM public.profile_entries pe
   WHERE pe.id = ANY(_remove_ids)
     AND pe.id <> v_keep.id
     AND pe.user_id = v_keep.user_id
     AND pe.contact_id IS NOT DISTINCT FROM v_keep.contact_id
     AND COALESCE(pe.is_pinned, false) = false;

  IF array_length(v_ids, 1) IS NULL
     AND COALESCE(NULLIF(btrim(_label), ''), v_keep.label) = v_keep.label
     AND COALESCE(NULLIF(btrim(_value), ''), v_keep.value) = v_keep.value THEN
    RETURN jsonb_build_object('applied', false, 'reason', 'nothing_to_do');
  END IF;

  PERFORM set_config('menerio.profile_guard', 'on', true);
  PERFORM set_config('menerio.profile_audit', 'on', true);

  IF array_length(v_ids, 1) IS NOT NULL THEN
    DELETE FROM public.profile_entries WHERE id = ANY(v_ids);
  END IF;

  UPDATE public.profile_entries
     SET label = COALESCE(NULLIF(btrim(_label), ''), label),
         value = COALESCE(NULLIF(btrim(_value), ''), value),
         updated_at = now()
   WHERE id = v_keep.id;

  INSERT INTO public.profile_audit_merges (
    run_id, user_id, contact_id, kept_entry_id, kept_label, kept_value, removed, reason
  ) VALUES (
    _run_id, v_keep.user_id, v_keep.contact_id, v_keep.id,
    COALESCE(NULLIF(btrim(_label), ''), v_keep.label),
    COALESCE(NULLIF(btrim(_value), ''), v_keep.value),
    v_removed, _reason
  ) RETURNING id INTO v_merge_id;

  PERFORM set_config('menerio.profile_guard', 'off', true);
  PERFORM set_config('menerio.profile_audit', 'off', true);

  RETURN jsonb_build_object(
    'applied', true,
    'merge_id', v_merge_id,
    'removed', COALESCE(array_length(v_ids, 1), 0)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.profile_audit_rollback_merge(_merge_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_merge record;
  v_item jsonb;
  v_restored integer := 0;
BEGIN
  SELECT * INTO v_merge FROM public.profile_audit_merges WHERE id = _merge_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('rolled_back', false, 'reason', 'not_found');
  END IF;
  IF v_merge.rolled_back_at IS NOT NULL THEN
    RETURN jsonb_build_object('rolled_back', false, 'reason', 'already_rolled_back');
  END IF;

  PERFORM set_config('menerio.profile_guard', 'on', true);
  PERFORM set_config('menerio.profile_audit', 'on', true);

  FOR v_item IN SELECT * FROM jsonb_array_elements(v_merge.removed)
  LOOP
    INSERT INTO public.profile_entries (
      id, user_id, category_id, contact_id, label, value,
      linked_note_id, sort_order, origin, evidence_quote, rank, is_pinned
    )
    VALUES (
      (v_item->>'id')::uuid,
      (v_item->>'user_id')::uuid,
      (v_item->>'category_id')::uuid,
      NULLIF(v_item->>'contact_id', '')::uuid,
      v_item->>'label',
      v_item->>'value',
      NULLIF(v_item->>'linked_note_id', '')::uuid,
      NULLIF(v_item->>'sort_order', '')::integer,
      COALESCE(v_item->>'origin', 'user_manual'),
      v_item->>'evidence_quote',
      COALESCE(v_item->>'rank', 'normal'),
      COALESCE((v_item->>'is_pinned')::boolean, false)
    )
    ON CONFLICT (id) DO NOTHING;
    v_restored := v_restored + 1;
  END LOOP;

  UPDATE public.profile_audit_merges SET rolled_back_at = now() WHERE id = _merge_id;

  PERFORM set_config('menerio.profile_guard', 'off', true);
  PERFORM set_config('menerio.profile_audit', 'off', true);

  RETURN jsonb_build_object('rolled_back', true, 'restored', v_restored);
END;
$$;
