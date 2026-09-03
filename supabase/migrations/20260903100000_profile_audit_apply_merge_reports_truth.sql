-- profile_audit_apply_merge must report what it actually did, not what it meant to do.
--
-- THE INCIDENT (2026-08-30 12:00 UTC to 2026-09-01 16:30 UTC, 52 hours)
-- `profile-audit.main` made 1,733 LLM calls for 2.27 million tokens and changed
-- nothing. 24 calls an hour, hour after hour, every call byte-identical at
-- 1,919 prompt + 156 completion tokens. The same merge row was written 1,049
-- times. It stopped only because one account's monthly allowance hit zero.
--
-- WHY
-- Two triggers added on 2026-08-16 (`world_preferred_survives_delete`,
-- `world_preferred_wins`) veto a machine's write to a hand-typed row. They do it
-- silently and raise nothing, on purpose: "a batch job that touches one
-- hand-edited row among a hundred must not die", and "losing the row is worse
-- than losing the tidy-up that wanted it gone". Both of those are right and both
-- stay exactly as they are.
--
-- This function was the liar. It counted the rows it INTENDED to delete, ran a
-- DELETE that the trigger silently cancelled, and then returned that intended
-- count as fact:
--
--     RETURN jsonb_build_object('applied', true, 'removed', array_length(v_ids,1));
--
-- It never checked ROW_COUNT. The caller in profile-audit/index.ts uses
-- `res.applied` as its ONLY measure of progress, so it never broke out of its
-- round loop, ran all 6 rounds against an unchanged entry list, and then marked
-- the scope "dirty" ("come back and finish this"), which the */15 cron sweep
-- obeyed 15 minutes later. Forever.
--
-- Proven in production on 2026-09-03 inside a rolled-back transaction:
--   PROOF: auth_uid_is_null=t rows_actually_deleted=0
--
-- WHAT CHANGED HERE
-- 1. A row a machine can never delete is never counted as removable: the
--    candidate query now excludes `rank = 'preferred'` when auth.uid() is null,
--    the same condition the delete trigger uses.
-- 2. A rewrite that will be reverted is never requested: when the keep row is
--    preferred and the caller is a machine, the wanted label/value are pinned to
--    the row's existing words, because world_preferred_wins would put them back.
-- 3. GET DIAGNOSTICS ROW_COUNT after the DELETE, and a read-back of the keep row
--    after the UPDATE. Those two are the truth.
-- 4. When nothing really moved: `applied: false` with a reason, and NO
--    profile_audit_merges row. Still no exception, so a batch survives.
--
-- Idempotent (CREATE OR REPLACE). Signature and return shape are unchanged, so
-- the existing callers and the REVOKEs from 20260816024503 still apply. Rollback
-- lives in supabase/rollback/.

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
SET search_path TO 'public'
AS $function$
DECLARE
  v_keep record;
  v_removed jsonb;
  v_ids uuid[];
  v_merge_id uuid;
  v_is_machine boolean := auth.uid() IS NULL;
  v_intended integer := 0;
  v_deleted integer := 0;
  v_want_label text;
  v_want_value text;
  v_after_label text;
  v_after_value text;
  v_words_changed boolean := false;
BEGIN
  SELECT * INTO v_keep FROM public.profile_entries WHERE id = _keep_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('applied', false, 'removed', 0, 'reason', 'keep_missing');
  END IF;

  v_want_label := COALESCE(NULLIF(btrim(_label), ''), v_keep.label);
  v_want_value := COALESCE(NULLIF(btrim(_value), ''), v_keep.value);

  -- A machine cannot rewrite a hand-typed row's words. Do not ask.
  IF v_is_machine AND v_keep.rank = 'preferred' THEN
    v_want_label := v_keep.label;
    v_want_value := v_keep.value;
  END IF;

  -- Candidate rows to remove. The last condition mirrors
  -- world_preferred_survives_delete exactly: what that trigger will veto must
  -- never enter this list, because everything downstream counts this list.
  SELECT COALESCE(jsonb_agg(to_jsonb(pe)), '[]'::jsonb),
         COALESCE(array_agg(pe.id), ARRAY[]::uuid[])
    INTO v_removed, v_ids
    FROM public.profile_entries pe
   WHERE pe.id = ANY(_remove_ids)
     AND pe.id <> v_keep.id
     AND pe.user_id = v_keep.user_id
     AND pe.contact_id IS NOT DISTINCT FROM v_keep.contact_id
     AND COALESCE(pe.is_pinned, false) = false
     AND NOT (v_is_machine AND pe.rank = 'preferred');

  v_intended := COALESCE(array_length(v_ids, 1), 0);

  IF v_intended = 0
     AND v_want_label = v_keep.label
     AND v_want_value = v_keep.value THEN
    RETURN jsonb_build_object('applied', false, 'removed', 0, 'reason', 'nothing_to_do');
  END IF;

  PERFORM set_config('menerio.profile_guard', 'on', true);
  PERFORM set_config('menerio.profile_audit', 'on', true);

  IF v_intended > 0 THEN
    DELETE FROM public.profile_entries WHERE id = ANY(v_ids);
    GET DIAGNOSTICS v_deleted = ROW_COUNT;
  END IF;

  IF v_want_label <> v_keep.label OR v_want_value <> v_keep.value THEN
    UPDATE public.profile_entries
       SET label = v_want_label,
           value = v_want_value,
           updated_at = now()
     WHERE id = v_keep.id;

    -- Read it back. A BEFORE UPDATE trigger may have restored the old words.
    SELECT label, value INTO v_after_label, v_after_value
      FROM public.profile_entries WHERE id = v_keep.id;

    v_words_changed := (v_after_label IS DISTINCT FROM v_keep.label)
                    OR (v_after_value IS DISTINCT FROM v_keep.value);
  END IF;

  -- Nothing moved. Say so, record nothing, and let the caller stop.
  IF v_deleted = 0 AND NOT v_words_changed THEN
    RETURN jsonb_build_object(
      'applied', false,
      'removed', 0,
      'reason', CASE WHEN v_intended > 0 THEN 'delete_vetoed' ELSE 'update_vetoed' END,
      'intended', v_intended
    );
  END IF;

  -- Record only the rows that are genuinely gone.
  IF v_deleted < v_intended THEN
    SELECT COALESCE(jsonb_agg(r), '[]'::jsonb) INTO v_removed
      FROM jsonb_array_elements(v_removed) r
     WHERE NOT EXISTS (
       SELECT 1 FROM public.profile_entries pe WHERE pe.id = (r->>'id')::uuid
     );
  END IF;

  INSERT INTO public.profile_audit_merges (
    run_id, user_id, contact_id, kept_entry_id, kept_label, kept_value, removed, reason
  ) VALUES (
    _run_id, v_keep.user_id, v_keep.contact_id, v_keep.id,
    COALESCE(v_after_label, v_want_label),
    COALESCE(v_after_value, v_want_value),
    v_removed, _reason
  ) RETURNING id INTO v_merge_id;

  RETURN jsonb_build_object(
    'applied', true,
    'merge_id', v_merge_id,
    'removed', v_deleted,
    'intended', v_intended,
    'partial', v_deleted < v_intended,
    'words_changed', v_words_changed
  );
END;
$function$;

-- Same grants as the original: service role only, never the client.
REVOKE EXECUTE ON FUNCTION public.profile_audit_apply_merge(uuid, uuid, uuid[], text, text, text)
  FROM anon, authenticated;
