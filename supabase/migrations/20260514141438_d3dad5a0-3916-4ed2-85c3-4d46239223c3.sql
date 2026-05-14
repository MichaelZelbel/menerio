
-- llm_usage_events: prevent client-side writes (server/service role only)
CREATE POLICY "Block client inserts" ON public.llm_usage_events FOR INSERT TO authenticated WITH CHECK (false);
CREATE POLICY "Block client updates" ON public.llm_usage_events FOR UPDATE TO authenticated USING (false) WITH CHECK (false);
CREATE POLICY "Block client deletes" ON public.llm_usage_events FOR DELETE TO authenticated USING (false);

-- sync_log: prevent client-side writes
CREATE POLICY "Block client inserts" ON public.sync_log FOR INSERT TO authenticated WITH CHECK (false);
CREATE POLICY "Block client updates" ON public.sync_log FOR UPDATE TO authenticated USING (false) WITH CHECK (false);
CREATE POLICY "Block client deletes" ON public.sync_log FOR DELETE TO authenticated USING (false);

-- weekly_reviews: missing UPDATE
CREATE POLICY "Users can update own reviews" ON public.weekly_reviews
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- mcp_call_logs: missing UPDATE/DELETE
CREATE POLICY "Users can update their own MCP call logs" ON public.mcp_call_logs
  FOR UPDATE TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can delete their own MCP call logs" ON public.mcp_call_logs
  FOR DELETE TO authenticated
  USING (auth.uid() = user_id);

-- conversation_messages: missing UPDATE/DELETE
CREATE POLICY "Users can update their own conversation messages" ON public.conversation_messages
  FOR UPDATE TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can delete their own conversation messages" ON public.conversation_messages
  FOR DELETE TO authenticated
  USING (auth.uid() = user_id);

-- moment_provenance: missing UPDATE
CREATE POLICY "Users can update their own moment provenance" ON public.moment_provenance
  FOR UPDATE TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (
    auth.uid() = user_id
    AND EXISTS (SELECT 1 FROM public.moments WHERE moments.id = moment_provenance.moment_id AND moments.user_id = auth.uid())
  );

-- generation_logs: missing UPDATE/DELETE
CREATE POLICY "Users can update their own generation logs" ON public.generation_logs
  FOR UPDATE TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can delete their own generation logs" ON public.generation_logs
  FOR DELETE TO authenticated
  USING (auth.uid() = user_id);

-- moderation_events: tighten INSERT to require ownership of referenced item
DROP POLICY IF EXISTS "Users can insert own moderation events" ON public.moderation_events;
CREATE POLICY "Users can insert own moderation events" ON public.moderation_events
  FOR INSERT TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND (
      item_id IS NULL
      OR EXISTS (SELECT 1 FROM public.notes WHERE notes.id = moderation_events.item_id AND notes.user_id = auth.uid())
      OR EXISTS (SELECT 1 FROM public.contacts WHERE contacts.id = moderation_events.item_id AND contacts.user_id = auth.uid())
    )
  );
