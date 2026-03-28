
-- Connected apps table for cross-app integration
CREATE TABLE public.connected_apps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid(),
  app_name text NOT NULL,
  display_name text NOT NULL,
  webhook_url text,
  api_key text NOT NULL,
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(user_id, app_name)
);

ALTER TABLE public.connected_apps ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own connected apps" ON public.connected_apps
  FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE TRIGGER set_connected_apps_updated_at
  BEFORE UPDATE ON public.connected_apps
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_updated_at();
