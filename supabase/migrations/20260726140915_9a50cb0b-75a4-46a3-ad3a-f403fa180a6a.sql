ALTER TABLE public.ai_suggestion_preferences
  ADD COLUMN IF NOT EXISTS profile_language text NOT NULL DEFAULT 'English';