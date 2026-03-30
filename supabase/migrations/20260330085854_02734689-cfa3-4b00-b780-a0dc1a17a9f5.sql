
-- Telegram connections table for per-user bot integration
CREATE TABLE public.telegram_connections (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL UNIQUE,
  telegram_chat_id bigint,
  bot_token text NOT NULL,
  webhook_secret text NOT NULL DEFAULT encode(gen_random_bytes(16), 'hex'),
  pairing_code text,
  is_active boolean DEFAULT true,
  is_paired boolean DEFAULT false,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- RLS
ALTER TABLE public.telegram_connections ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own telegram connection"
  ON public.telegram_connections
  FOR ALL
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- Updated_at trigger
CREATE TRIGGER handle_telegram_connections_updated_at
  BEFORE UPDATE ON public.telegram_connections
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_updated_at();
