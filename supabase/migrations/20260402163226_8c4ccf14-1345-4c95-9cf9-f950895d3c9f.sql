
-- Create table for hub API keys
CREATE TABLE public.hub_api_keys (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL DEFAULT auth.uid(),
  key_hash text NOT NULL,
  key_prefix text NOT NULL,
  name text NOT NULL,
  scopes text[] NOT NULL DEFAULT '{profile}',
  last_used_at timestamptz,
  expires_at timestamptz,
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now()
);

-- Indexes
CREATE INDEX idx_hub_api_keys_user ON public.hub_api_keys(user_id);
CREATE INDEX idx_hub_api_keys_hash ON public.hub_api_keys(key_hash);

-- Enable RLS
ALTER TABLE public.hub_api_keys ENABLE ROW LEVEL SECURITY;

-- Users can manage their own keys
CREATE POLICY "Users can manage own API keys"
  ON public.hub_api_keys
  FOR ALL
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());
