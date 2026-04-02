ALTER TABLE public.hub_api_usage
ADD CONSTRAINT hub_api_usage_key_window_unique UNIQUE (key_id, window_start);