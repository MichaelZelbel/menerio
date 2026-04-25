CREATE POLICY "No direct client access to hub API usage"
ON public.hub_api_usage
FOR ALL
TO authenticated
USING (false)
WITH CHECK (false);