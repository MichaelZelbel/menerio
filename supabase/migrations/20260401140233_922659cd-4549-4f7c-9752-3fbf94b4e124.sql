CREATE POLICY "Admins can view all usage events"
ON public.llm_usage_events
FOR SELECT
TO authenticated
USING (is_admin(auth.uid()));