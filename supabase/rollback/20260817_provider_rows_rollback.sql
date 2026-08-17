-- Rollback for 20260817140100_mira_and_note_chat_to_openrouter.sql
--
-- NOT a migration. Kept outside supabase/migrations/ deliberately, so a rebuild
-- never runs it. Copy the statements you need.
--
-- Puts Mira and the in-note chat back on the Lovable AI gateway. Both are then
-- billed to the Lovable workspace again, and both stop answering whenever that
-- workspace runs out of credits, which is the behaviour the migration removed.
--
-- Guarded on the values the migration wrote, so a row edited by hand since then
-- is left alone.

update public.llm_call_configs
set provider = 'lovable'
where call_site = 'conversation-chat.main'
  and provider = 'openrouter'
  and model = 'google/gemini-2.5-flash';

update public.llm_call_configs
set provider = 'lovable'
where call_site = 'note-chat.main'
  and provider = 'openrouter'
  and model = 'google/gemini-2.5-flash';

-- Read back, then wait out the 30 second config cache before testing:
--   select call_site, provider, model, enabled
--   from public.llm_call_configs
--   where call_site in ('conversation-chat.main','note-chat.main');
