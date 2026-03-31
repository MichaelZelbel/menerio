-- Partial unique index on idempotency_key for deduplication
CREATE UNIQUE INDEX IF NOT EXISTS idx_llm_usage_events_idempotency_key
  ON public.llm_usage_events (idempotency_key)
  WHERE idempotency_key IS NOT NULL;

-- Atomic token deduction function with row-level locking
CREATE OR REPLACE FUNCTION public.deduct_ai_tokens(
  p_user_id uuid,
  p_tokens integer,
  p_feature text,
  p_model text DEFAULT NULL,
  p_provider text DEFAULT 'openrouter',
  p_prompt_tokens integer DEFAULT 0,
  p_completion_tokens integer DEFAULT 0,
  p_idempotency_key text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_period_id uuid;
  v_tokens_granted bigint;
  v_tokens_used bigint;
  v_remaining bigint;
  v_tokens_per_credit integer;
BEGIN
  -- Lock the current active period row (prevents race conditions)
  SELECT id, tokens_granted, tokens_used,
         COALESCE((metadata->>'tokens_per_credit')::integer, 200)
  INTO v_period_id, v_tokens_granted, v_tokens_used, v_tokens_per_credit
  FROM ai_allowance_periods
  WHERE user_id = p_user_id
    AND period_start <= now()
    AND period_end > now()
  ORDER BY period_start DESC
  LIMIT 1
  FOR UPDATE;

  IF v_period_id IS NULL THEN
    RETURN jsonb_build_object(
      'allowed', false,
      'error', 'no_active_period',
      'remaining_tokens', 0,
      'remaining_credits', 0
    );
  END IF;

  v_remaining := v_tokens_granted - v_tokens_used;

  IF v_remaining < p_tokens THEN
    RETURN jsonb_build_object(
      'allowed', false,
      'error', 'insufficient_balance',
      'remaining_tokens', v_remaining,
      'remaining_credits', v_remaining / v_tokens_per_credit
    );
  END IF;

  -- Atomically deduct tokens
  UPDATE ai_allowance_periods
  SET tokens_used = tokens_used + p_tokens, updated_at = now()
  WHERE id = v_period_id;

  v_remaining := v_tokens_granted - (v_tokens_used + p_tokens);

  -- Log usage event (idempotency-safe)
  IF p_idempotency_key IS NOT NULL THEN
    INSERT INTO llm_usage_events (
      user_id, feature, model, provider,
      prompt_tokens, completion_tokens, total_tokens,
      credits_charged, idempotency_key
    ) VALUES (
      p_user_id, p_feature, p_model, p_provider,
      p_prompt_tokens, p_completion_tokens, p_tokens,
      CEIL(p_tokens::numeric / v_tokens_per_credit),
      p_idempotency_key
    ) ON CONFLICT (idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING;
  ELSE
    INSERT INTO llm_usage_events (
      user_id, feature, model, provider,
      prompt_tokens, completion_tokens, total_tokens,
      credits_charged
    ) VALUES (
      p_user_id, p_feature, p_model, p_provider,
      p_prompt_tokens, p_completion_tokens, p_tokens,
      CEIL(p_tokens::numeric / v_tokens_per_credit)
    );
  END IF;

  RETURN jsonb_build_object(
    'allowed', true,
    'tokens_deducted', p_tokens,
    'remaining_tokens', v_remaining,
    'remaining_credits', v_remaining / v_tokens_per_credit,
    'tokens_per_credit', v_tokens_per_credit
  );
END;
$$;