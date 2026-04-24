ALTER TABLE public.review_queue
  ADD COLUMN IF NOT EXISTS target_entity_type text,
  ADD COLUMN IF NOT EXISTS target_entity_id uuid,
  ADD COLUMN IF NOT EXISTS source_title text,
  ADD COLUMN IF NOT EXISTS extracted_value text,
  ADD COLUMN IF NOT EXISTS confidence_score double precision,
  ADD COLUMN IF NOT EXISTS is_sensitive boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS applied_at timestamp with time zone,
  ADD COLUMN IF NOT EXISTS blocked_at timestamp with time zone,
  ADD COLUMN IF NOT EXISTS suppression_key text;

CREATE TABLE IF NOT EXISTS public.ai_suggestion_preferences (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL DEFAULT auth.uid() UNIQUE,
  suggestion_mode text NOT NULL DEFAULT 'auto',
  suggestion_sensitivity text NOT NULL DEFAULT 'balanced',
  auto_add_sensitive boolean NOT NULL DEFAULT false,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT ai_suggestion_preferences_mode_check CHECK (suggestion_mode IN ('auto', 'ask', 'off')),
  CONSTRAINT ai_suggestion_preferences_sensitivity_check CHECK (suggestion_sensitivity IN ('conservative', 'balanced', 'exploratory'))
);

ALTER TABLE public.ai_suggestion_preferences ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can manage own AI suggestion preferences" ON public.ai_suggestion_preferences;
CREATE POLICY "Users can manage own AI suggestion preferences"
ON public.ai_suggestion_preferences
FOR ALL
TO authenticated
USING (user_id = auth.uid())
WITH CHECK (user_id = auth.uid());

CREATE TABLE IF NOT EXISTS public.ai_suggestion_suppressions (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL DEFAULT auth.uid(),
  suggestion_type text NOT NULL,
  target_entity_type text,
  target_entity_id uuid,
  normalized_value text NOT NULL,
  source_category text,
  suppression_key text NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  UNIQUE (user_id, suppression_key)
);

ALTER TABLE public.ai_suggestion_suppressions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can manage own AI suggestion suppressions" ON public.ai_suggestion_suppressions;
CREATE POLICY "Users can manage own AI suggestion suppressions"
ON public.ai_suggestion_suppressions
FOR ALL
TO authenticated
USING (user_id = auth.uid())
WITH CHECK (user_id = auth.uid());

CREATE INDEX IF NOT EXISTS idx_review_queue_active_ai_changes
ON public.review_queue (user_id, status, created_at DESC)
WHERE status IN ('pending_review', 'auto_applied_unreviewed', 'pending');

CREATE INDEX IF NOT EXISTS idx_review_queue_suppression_key
ON public.review_queue (user_id, suppression_key)
WHERE suppression_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_ai_suggestion_suppressions_lookup
ON public.ai_suggestion_suppressions (user_id, suggestion_type, suppression_key);

DROP TRIGGER IF EXISTS update_ai_suggestion_preferences_updated_at ON public.ai_suggestion_preferences;
CREATE TRIGGER update_ai_suggestion_preferences_updated_at
BEFORE UPDATE ON public.ai_suggestion_preferences
FOR EACH ROW
EXECUTE FUNCTION public.handle_updated_at();