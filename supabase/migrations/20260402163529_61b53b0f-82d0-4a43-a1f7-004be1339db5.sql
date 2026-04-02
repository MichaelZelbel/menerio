
CREATE TABLE public.hub_api_usage (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  key_id uuid NOT NULL REFERENCES public.hub_api_keys(id) ON DELETE CASCADE,
  window_start timestamptz NOT NULL,
  request_count integer NOT NULL DEFAULT 1,
  created_at timestamptz DEFAULT now(),
  UNIQUE(key_id, window_start)
);

CREATE INDEX idx_hub_api_usage_key_window ON public.hub_api_usage(key_id, window_start);

ALTER TABLE public.hub_api_usage ENABLE ROW LEVEL SECURITY;

-- No direct access — managed by service role in edge functions
