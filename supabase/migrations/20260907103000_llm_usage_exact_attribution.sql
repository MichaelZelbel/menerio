-- Live 8/9-argument bodies verified against 20260827101500 on 2026-09-07.
-- Keep both legacy signatures and their financial calculations unchanged.
-- New callers use one transaction for the charge and exact event attribution.
ALTER TABLE public.llm_usage_events
  ADD COLUMN IF NOT EXISTS job_id uuid,
  ADD COLUMN IF NOT EXISTS revision text,
  ADD COLUMN IF NOT EXISTS stage text;

CREATE OR REPLACE FUNCTION public.deduct_ai_tokens_attributed(
  p_user_id uuid, p_tokens integer, p_feature text,
  p_model text DEFAULT NULL, p_provider text DEFAULT 'openrouter',
  p_prompt_tokens integer DEFAULT 0, p_completion_tokens integer DEFAULT 0,
  p_idempotency_key text DEFAULT NULL, p_usage_source text DEFAULT 'unknown',
  p_call_site text DEFAULT NULL, p_config_source text DEFAULT NULL,
  p_note_id uuid DEFAULT NULL, p_job_id uuid DEFAULT NULL,
  p_revision text DEFAULT NULL, p_stage text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_key text := COALESCE(p_idempotency_key, gen_random_uuid()::text);
  v_result jsonb;
  v_event_id uuid;
  v_existing public.llm_usage_events%ROWTYPE;
  v_request jsonb := jsonb_build_object(
    'user_id', p_user_id, 'tokens', p_tokens, 'feature', p_feature,
    'model', p_model, 'provider', p_provider, 'prompt_tokens', p_prompt_tokens,
    'completion_tokens', p_completion_tokens, 'usage_source', p_usage_source,
    'call_site', p_call_site, 'config_source', p_config_source, 'note_id', p_note_id,
    'job_id', p_job_id, 'revision', p_revision, 'stage', p_stage);
BEGIN
  -- The live legacy function deduplicates only INSERT, after changing balance.
  -- Serialize the key before reading it so concurrent retries never reach it twice.
  PERFORM pg_advisory_xact_lock(hashtextextended(v_key, 0));
  SELECT * INTO v_existing FROM public.llm_usage_events WHERE idempotency_key = v_key;
  IF FOUND THEN
    -- Never relabel history or reuse another account's key. Legacy keys have
    -- no saved request/result, so fail safely rather than deducting again.
    IF v_existing.metadata->'attribution_request' IS DISTINCT FROM v_request
       OR v_existing.metadata->'deduction_result' IS NULL THEN
      RAISE EXCEPTION 'idempotency_key_conflict';
    END IF;
    RETURN v_existing.metadata->'deduction_result';
  END IF;

  -- Explicit ninth argument selects the live usage-source overload.
  v_result := public.deduct_ai_tokens(p_user_id, p_tokens, p_feature,
    p_model, p_provider, p_prompt_tokens, p_completion_tokens, v_key, p_usage_source);
  IF NOT (v_result->>'allowed')::boolean THEN RETURN v_result; END IF;

  UPDATE public.llm_usage_events
  SET call_site = p_call_site, config_source = p_config_source,
      note_id = p_note_id, job_id = p_job_id, revision = p_revision, stage = p_stage
  WHERE idempotency_key = v_key AND user_id = p_user_id
  RETURNING id INTO v_event_id;
  IF v_event_id IS NULL THEN RAISE EXCEPTION 'usage_event_missing'; END IF;
  v_result := v_result || jsonb_build_object('usage_event_id', v_event_id);
  UPDATE public.llm_usage_events
  SET metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object(
    'deduction_result', v_result, 'attribution_request', v_request)
  WHERE id = v_event_id;
  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.deduct_ai_tokens_attributed(uuid,integer,text,text,text,integer,integer,text,text,text,text,uuid,uuid,text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.deduct_ai_tokens_attributed(uuid,integer,text,text,text,integer,integer,text,text,text,text,uuid,uuid,text,text) TO service_role;