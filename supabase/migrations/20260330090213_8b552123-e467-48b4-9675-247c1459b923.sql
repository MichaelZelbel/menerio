
CREATE TABLE public.discord_connections (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL UNIQUE,
  discord_guild_id text NOT NULL,
  discord_channel_id text,
  bot_token text NOT NULL,
  application_id text NOT NULL,
  public_key text NOT NULL,
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE public.discord_connections ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own discord connection"
  ON public.discord_connections
  FOR ALL
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE TRIGGER handle_discord_connections_updated_at
  BEFORE UPDATE ON public.discord_connections
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_updated_at();
