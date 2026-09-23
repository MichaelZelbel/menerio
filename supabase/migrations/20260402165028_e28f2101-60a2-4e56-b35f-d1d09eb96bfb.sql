ALTER TABLE public.godspeed_api_usage
ADD CONSTRAINT godspeed_api_usage_key_window_unique UNIQUE (key_id, window_start);