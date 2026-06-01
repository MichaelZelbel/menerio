CREATE TABLE public.llm_call_configs (
  call_site TEXT PRIMARY KEY,
  description TEXT,
  provider TEXT NOT NULL DEFAULT 'lovable',
  model TEXT NOT NULL,
  system_prompt TEXT,
  temperature NUMERIC,
  max_tokens INTEGER,
  extra_options JSONB NOT NULL DEFAULT '{}'::jsonb,
  enabled BOOLEAN NOT NULL DEFAULT true,
  updated_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT llm_call_configs_provider_chk
    CHECK (provider IN ('lovable','openrouter','openai','anthropic','gemini'))
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.llm_call_configs TO authenticated;
GRANT ALL ON public.llm_call_configs TO service_role;

ALTER TABLE public.llm_call_configs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can read llm_call_configs"
  ON public.llm_call_configs
  FOR SELECT
  TO authenticated
  USING (is_admin(auth.uid()));

CREATE POLICY "Admins can write llm_call_configs"
  ON public.llm_call_configs
  FOR ALL
  TO authenticated
  USING (is_admin(auth.uid()))
  WITH CHECK (is_admin(auth.uid()));

CREATE TRIGGER trg_llm_call_configs_updated_at
BEFORE UPDATE ON public.llm_call_configs
FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

ALTER TABLE public.llm_usage_events
  ADD COLUMN IF NOT EXISTS call_site TEXT,
  ADD COLUMN IF NOT EXISTS config_source TEXT;

CREATE INDEX IF NOT EXISTS idx_llm_usage_events_call_site
  ON public.llm_usage_events (call_site);

INSERT INTO public.llm_call_configs (call_site, description, provider, model, system_prompt, enabled)
VALUES
  ('process-note.profile_extraction', 'Extracts profile facts from a note and writes to the Review Queue.', 'lovable', 'google/gemini-2.5-flash', NULL, true),
  ('note-chat.main', 'Chat against a single note (note-scoped AI chat).', 'lovable', 'google/gemini-2.5-flash', NULL, true),
  ('conversation-chat.main', 'Person-scoped conversation chat (Conversation tab).', 'lovable', 'google/gemini-2.5-flash', NULL, true),
  ('analyze-media.ocr_extraction', 'OCR + summary extraction for uploaded media (PDF / images).', 'openrouter', 'openai/gpt-4o-mini', NULL, true),
  ('suggest-connections.main', 'Suggests related notes/people for the Discovery feed.', 'openrouter', 'openai/gpt-4o-mini', NULL, true),
  ('find-connections.main', 'On-demand "find related notes" lookup.', 'openrouter', 'openai/gpt-4o-mini', NULL, true),
  ('quick-capture.metadata', 'Quick-capture metadata extraction.', 'openrouter', 'openai/gpt-4o-mini', NULL, true),
  ('ingest-thought.metadata', 'Slack/Telegram ingest metadata extraction.', 'openrouter', 'openai/gpt-4o-mini', NULL, true),
  ('daily-digest.main', 'Generates the daily digest email/notification.', 'openrouter', 'openai/gpt-4o-mini', NULL, true),
  ('weekly-review.main', 'Generates the weekly review.', 'openrouter', 'openai/gpt-4o-mini', NULL, true),
  ('draft-event.main', 'Drafts a calendar/event proposal from a note.', 'openrouter', 'openai/gpt-4o-mini', NULL, true),
  ('extract-event.main', 'Extracts structured event info from a note.', 'openrouter', 'openai/gpt-4o-mini', NULL, true),
  ('wiki-ingest.main', 'Ingests wiki content (cleanup + structuring).', 'openrouter', 'openai/gpt-4o-mini', NULL, true),
  ('wiki-cleanup.main', 'Periodic wiki cleanup pass.', 'openrouter', 'openai/gpt-4o-mini', NULL, true),
  ('wiki-lint.main', 'Wiki linting suggestions.', 'openrouter', 'openai/gpt-4o-mini', NULL, true),
  ('generate-profile-suggestions.main', 'Suggests profile entries proactively.', 'openrouter', 'openai/gpt-4o-mini', NULL, true),
  ('ai-moderate-content.main', 'Async AI content moderation.', 'openrouter', 'openai/gpt-4o-mini', NULL, true),
  ('group-ai.suggest_members', 'Suggests members for a contact group.', 'openrouter', 'openai/gpt-4o-mini', NULL, true),
  ('group-ai.next_step', 'Suggests next step for a group membership.', 'openrouter', 'openai/gpt-4o-mini', NULL, true),
  ('group-ai.briefing', 'Generates group briefing.', 'openrouter', 'openai/gpt-4o-mini', NULL, true),
  ('embeddings.default', 'Text embeddings (used across notes, documents, semantic search).', 'openrouter', 'openai/text-embedding-3-small', NULL, true)
ON CONFLICT (call_site) DO NOTHING;