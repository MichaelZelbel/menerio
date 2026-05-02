ALTER TABLE public.ai_suggestion_preferences
ADD COLUMN IF NOT EXISTS person_blocklist text[] NOT NULL DEFAULT '{}';