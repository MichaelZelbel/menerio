-- Defect 4: Mira and the in-note chat stop working when the Lovable workspace
-- runs out of credits.
--
-- This one is NOT a bug. `conversation-chat.main` and `note-chat.main` each carry
-- a live row reading provider = lovable, model = google/gemini-2.5-flash, and the
-- router honours it. That is the system working exactly as designed. The
-- consequence is only that both are billed to the Lovable workspace, so when it
-- emptied on 2026-08-17 both stopped answering.
--
-- Michael's decision, 2026-08-17: move both to OpenRouter.
--
-- OpenRouter serves the same model id, so this changes ONLY which balance pays.
-- The model stays google/gemini-2.5-flash, which both rows carry deliberately and
-- which differs from CALL_SITE_DEFAULTS in llm-defaults.ts (minimax/minimax-m2.7
-- for both). That difference is intentional and must survive this migration, so
-- the model column is deliberately left alone.
--
-- Guarded on the exact current provider AND model rather than on a prompt hash,
-- because the prompt is not what changes here. A row that has since been edited
-- by hand matches nothing and is left untouched, and on a fresh database seeded
-- from the registry it also matches nothing and does nothing.
--
-- Rollback: supabase/rollback/20260817_provider_rows_rollback.sql

update public.llm_call_configs
set provider = 'openrouter'
where call_site = 'conversation-chat.main'
  and provider = 'lovable'
  and model = 'google/gemini-2.5-flash';

update public.llm_call_configs
set provider = 'openrouter'
where call_site = 'note-chat.main'
  and provider = 'lovable'
  and model = 'google/gemini-2.5-flash';

-- Read back and confirm. Both rows must now show openrouter with the model
-- unchanged. A migration file in the repo is not a change in production, so do
-- not skip this:
--
--   select call_site, provider, model, enabled
--   from public.llm_call_configs
--   where call_site in ('conversation-chat.main','note-chat.main');
--
-- Then wait longer than CACHE_TTL_MS (30 seconds, _shared/llm-router.ts) before
-- testing, or the edge functions answer from the cached old row and you will
-- think it failed.
