
-- Add permissions column and unique constraint on api_key
ALTER TABLE public.connected_apps
  ADD COLUMN IF NOT EXISTS permissions jsonb DEFAULT '{"can_push_notes": true, "can_receive_patches": true}'::jsonb;

-- Add unique constraint on api_key
ALTER TABLE public.connected_apps
  ADD CONSTRAINT connected_apps_api_key_unique UNIQUE (api_key);
