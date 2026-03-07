
-- 1. ai_credit_settings table
CREATE TABLE public.ai_credit_settings (
  key text PRIMARY KEY,
  value_int integer NOT NULL,
  description text
);

ALTER TABLE public.ai_credit_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read settings"
  ON public.ai_credit_settings FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Admins can update settings"
  ON public.ai_credit_settings FOR UPDATE
  TO authenticated
  USING (public.is_admin(auth.uid()))
  WITH CHECK (public.is_admin(auth.uid()));

-- Insert defaults
INSERT INTO public.ai_credit_settings (key, value_int, description) VALUES
  ('tokens_per_credit', 200, 'Number of LLM tokens equal to 1 AI credit'),
  ('credits_free_per_month', 0, 'Monthly AI credits granted to free-tier users'),
  ('credits_premium_per_month', 1500, 'Monthly AI credits granted to premium users');

-- 2. ai_allowance_periods table
CREATE TABLE public.ai_allowance_periods (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  tokens_granted bigint NOT NULL DEFAULT 0,
  tokens_used bigint NOT NULL DEFAULT 0,
  period_start timestamptz NOT NULL DEFAULT date_trunc('month', now()),
  period_end timestamptz NOT NULL DEFAULT (date_trunc('month', now()) + interval '1 month'),
  source text NOT NULL DEFAULT 'role_based'
    CHECK (source IN ('role_based', 'free_tier', 'admin_grant')),
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER set_ai_allowance_periods_updated_at
  BEFORE UPDATE ON public.ai_allowance_periods
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

ALTER TABLE public.ai_allowance_periods ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own allowance"
  ON public.ai_allowance_periods FOR SELECT
  TO authenticated
  USING (user_id = auth.uid() OR public.is_admin(auth.uid()));

CREATE POLICY "Admins can insert allowance"
  ON public.ai_allowance_periods FOR INSERT
  TO authenticated
  WITH CHECK (public.is_admin(auth.uid()));

CREATE POLICY "Admins can update allowance"
  ON public.ai_allowance_periods FOR UPDATE
  TO authenticated
  USING (public.is_admin(auth.uid()))
  WITH CHECK (public.is_admin(auth.uid()));

-- 3. llm_usage_events table
CREATE TABLE public.llm_usage_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  idempotency_key text UNIQUE,
  feature text NOT NULL,
  model text,
  provider text,
  prompt_tokens bigint NOT NULL DEFAULT 0,
  completion_tokens bigint NOT NULL DEFAULT 0,
  total_tokens bigint NOT NULL DEFAULT 0,
  credits_charged numeric NOT NULL DEFAULT 0,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.llm_usage_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own usage events"
  ON public.llm_usage_events FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

-- Trigger: auto-calculate total_tokens on insert
CREATE OR REPLACE FUNCTION public.calculate_total_tokens()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public
AS $$
BEGIN
  NEW.total_tokens := COALESCE(NEW.prompt_tokens, 0) + COALESCE(NEW.completion_tokens, 0);
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_calculate_total_tokens
  BEFORE INSERT ON public.llm_usage_events
  FOR EACH ROW EXECUTE FUNCTION public.calculate_total_tokens();

-- 4. View: v_ai_allowance_current
CREATE OR REPLACE VIEW public.v_ai_allowance_current AS
SELECT
  ap.id,
  ap.user_id,
  ap.tokens_granted,
  ap.tokens_used,
  (ap.tokens_granted - ap.tokens_used) AS remaining_tokens,
  CASE WHEN tpc.value_int > 0
    THEN ap.tokens_granted / tpc.value_int
    ELSE 0
  END AS credits_granted,
  CASE WHEN tpc.value_int > 0
    THEN ap.tokens_used / tpc.value_int
    ELSE 0
  END AS credits_used,
  CASE WHEN tpc.value_int > 0
    THEN (ap.tokens_granted - ap.tokens_used) / tpc.value_int
    ELSE 0
  END AS remaining_credits,
  ap.source,
  ap.period_start,
  ap.period_end,
  ap.metadata
FROM public.ai_allowance_periods ap
CROSS JOIN public.ai_credit_settings tpc
WHERE tpc.key = 'tokens_per_credit'
  AND now() >= ap.period_start
  AND now() < ap.period_end;
