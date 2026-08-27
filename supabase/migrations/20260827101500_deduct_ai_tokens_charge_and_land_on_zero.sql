-- Close the token drain hole found on 2026-08-27.
--
-- Symptom: OpenRouter billed 37.7M tokens in one day (about $6.75) across 5,063
-- calls, and `llm_usage_events` recorded none of them. The account never stopped.
--
-- Mechanism, in order:
--   1. `checkBalance` allows a call when `remaining_tokens > 0`. An account with
--      127 tokens left therefore passes every pre-check.
--   2. The provider is called and paid. A typical call costs 2,000 to 20,000
--      tokens, far more than the 127 that were left.
--   3. This function then refused the whole deduction (`v_remaining < p_tokens`),
--      wrote NO usage row, and left `tokens_used` untouched.
--   4. So the balance stayed at 127 forever: never zero, always above the
--      pre-check's bar. Every retry repeated steps 1 to 3, free of charge to the
--      ledger and fully charged to OpenRouter.
--   5. Because the work never landed, the retry sweeps re-queued the same items
--      every 33 seconds, around the clock.
--
-- Fix: the provider has already been paid by the time this function runs, so
-- refusing records nothing and changes nothing. Charge what is left, record the
-- TRUE cost of the call, and land the balance on exactly zero. One call may
-- overshoot the allowance; the next one is refused by the pre-check, because
-- zero is not greater than zero. The loop cannot re-arm.
--
-- `allowed` is true on this path on purpose: it reports whether the deduction was
-- applied, and the caller must not bin work the money cannot be un-spent on.
-- `capped` tells the caller it went over, and by how much.
--
-- Both overloads are replaced. They differ only in `p_usage_source`.

create or replace function public.deduct_ai_tokens(
  p_user_id uuid,
  p_tokens integer,
  p_feature text,
  p_model text default null::text,
  p_provider text default 'openrouter'::text,
  p_prompt_tokens integer default 0,
  p_completion_tokens integer default 0,
  p_idempotency_key text default null::text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
DECLARE
  v_period_id uuid;
  v_tokens_granted bigint;
  v_tokens_used bigint;
  v_remaining bigint;
  v_tokens_per_credit integer;
BEGIN
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

  v_remaining := GREATEST(v_tokens_granted - v_tokens_used, 0);

  -- Over the allowance: charge the remainder, record the real cost, land on zero.
  IF v_remaining < p_tokens THEN
    UPDATE ai_allowance_periods
    SET tokens_used = tokens_granted, updated_at = now()
    WHERE id = v_period_id;

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

    RETURN jsonb_build_object(
      'allowed', true,
      'capped', true,
      'overdraft_tokens', p_tokens - v_remaining,
      'tokens_deducted', v_remaining,
      'remaining_tokens', 0,
      'remaining_credits', 0,
      'tokens_per_credit', v_tokens_per_credit
    );
  END IF;

  UPDATE ai_allowance_periods
  SET tokens_used = tokens_used + p_tokens, updated_at = now()
  WHERE id = v_period_id;

  v_remaining := v_tokens_granted - (v_tokens_used + p_tokens);

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

create or replace function public.deduct_ai_tokens(
  p_user_id uuid,
  p_tokens integer,
  p_feature text,
  p_model text default null::text,
  p_provider text default 'openrouter'::text,
  p_prompt_tokens integer default 0,
  p_completion_tokens integer default 0,
  p_idempotency_key text default null::text,
  p_usage_source text default 'unknown'::text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
DECLARE
  v_period_id uuid;
  v_tokens_granted bigint;
  v_tokens_used bigint;
  v_remaining bigint;
  v_tokens_per_credit integer;
BEGIN
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

  v_remaining := GREATEST(v_tokens_granted - v_tokens_used, 0);

  -- Over the allowance: charge the remainder, record the real cost, land on zero.
  IF v_remaining < p_tokens THEN
    UPDATE ai_allowance_periods
    SET tokens_used = tokens_granted, updated_at = now()
    WHERE id = v_period_id;

    INSERT INTO llm_usage_events (
      user_id, feature, model, provider,
      prompt_tokens, completion_tokens, total_tokens,
      credits_charged, idempotency_key, metadata
    ) VALUES (
      p_user_id, p_feature, p_model, p_provider,
      p_prompt_tokens, p_completion_tokens, p_tokens,
      CEIL(p_tokens::numeric / v_tokens_per_credit),
      p_idempotency_key,
      jsonb_build_object('usage_source', p_usage_source, 'capped', true)
    ) ON CONFLICT (idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING;

    RETURN jsonb_build_object(
      'allowed', true,
      'capped', true,
      'overdraft_tokens', p_tokens - v_remaining,
      'tokens_deducted', v_remaining,
      'remaining_tokens', 0,
      'remaining_credits', 0,
      'tokens_per_credit', v_tokens_per_credit
    );
  END IF;

  UPDATE ai_allowance_periods
  SET tokens_used = tokens_used + p_tokens, updated_at = now()
  WHERE id = v_period_id;

  v_remaining := v_tokens_granted - (v_tokens_used + p_tokens);

  IF p_idempotency_key IS NOT NULL THEN
    INSERT INTO llm_usage_events (
      user_id, feature, model, provider,
      prompt_tokens, completion_tokens, total_tokens,
      credits_charged, idempotency_key, metadata
    ) VALUES (
      p_user_id, p_feature, p_model, p_provider,
      p_prompt_tokens, p_completion_tokens, p_tokens,
      CEIL(p_tokens::numeric / v_tokens_per_credit),
      p_idempotency_key,
      jsonb_build_object('usage_source', p_usage_source)
    ) ON CONFLICT (idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING;
  ELSE
    INSERT INTO llm_usage_events (
      user_id, feature, model, provider,
      prompt_tokens, completion_tokens, total_tokens,
      credits_charged, metadata
    ) VALUES (
      p_user_id, p_feature, p_model, p_provider,
      p_prompt_tokens, p_completion_tokens, p_tokens,
      CEIL(p_tokens::numeric / v_tokens_per_credit),
      jsonb_build_object('usage_source', p_usage_source)
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
