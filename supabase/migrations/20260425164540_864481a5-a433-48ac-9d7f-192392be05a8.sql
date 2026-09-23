CREATE POLICY "No direct client access to godspeed API usage"
ON public.godspeed_api_usage
FOR ALL
TO authenticated
USING (false)
WITH CHECK (false);