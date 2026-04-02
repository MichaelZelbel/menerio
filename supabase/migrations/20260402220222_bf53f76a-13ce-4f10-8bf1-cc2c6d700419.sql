
-- Add connection_status column to connected_apps
ALTER TABLE public.connected_apps
ADD COLUMN connection_status text NOT NULL DEFAULT 'pending';

-- Set existing active rows to 'active' so they don't break
UPDATE public.connected_apps
SET connection_status = 'active'
WHERE is_active = true;
