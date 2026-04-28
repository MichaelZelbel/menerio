CREATE TABLE IF NOT EXISTS public.group_briefings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id uuid NOT NULL REFERENCES public.contact_groups(id) ON DELETE CASCADE,
  user_id uuid NOT NULL DEFAULT auth.uid(),
  period_days integer NOT NULL DEFAULT 7,
  briefing_markdown text NOT NULL,
  generated_at timestamp with time zone NOT NULL DEFAULT now(),
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE public.group_briefings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view their own group briefings" ON public.group_briefings;
CREATE POLICY "Users can view their own group briefings"
ON public.group_briefings
FOR SELECT
TO authenticated
USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can create their own group briefings" ON public.group_briefings;
CREATE POLICY "Users can create their own group briefings"
ON public.group_briefings
FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update their own group briefings" ON public.group_briefings;
CREATE POLICY "Users can update their own group briefings"
ON public.group_briefings
FOR UPDATE
TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete their own group briefings" ON public.group_briefings;
CREATE POLICY "Users can delete their own group briefings"
ON public.group_briefings
FOR DELETE
TO authenticated
USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_group_briefings_group_generated_at
ON public.group_briefings (group_id, generated_at DESC);

CREATE INDEX IF NOT EXISTS idx_group_briefings_user_group
ON public.group_briefings (user_id, group_id);

INSERT INTO public.ai_credit_settings (key, value_int, description)
VALUES
  ('group_next_step', 5, 'Credits charged for suggesting a next step for a group membership'),
  ('group_member_suggestions', 20, 'Credits charged for suggesting group members from notes'),
  ('group_briefing', 30, 'Credits charged for generating a group briefing')
ON CONFLICT (key) DO UPDATE
SET value_int = EXCLUDED.value_int,
    description = EXCLUDED.description;