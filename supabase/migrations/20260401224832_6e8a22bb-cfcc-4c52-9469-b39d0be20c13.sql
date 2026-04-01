
-- Profile categories
CREATE TABLE public.profile_categories (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL,
  slug text NOT NULL,
  icon text,
  description text,
  sort_order int DEFAULT 0,
  is_default boolean DEFAULT false,
  visibility_scope text DEFAULT 'all',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(user_id, slug)
);

ALTER TABLE public.profile_categories ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own profile categories"
  ON public.profile_categories FOR ALL
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Admins can view all profile categories"
  ON public.profile_categories FOR SELECT
  TO authenticated
  USING (public.is_admin(auth.uid()));

-- Profile entries
CREATE TABLE public.profile_entries (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  category_id uuid NOT NULL REFERENCES public.profile_categories(id) ON DELETE CASCADE,
  label text NOT NULL,
  value text NOT NULL,
  linked_note_id uuid REFERENCES public.notes(id) ON DELETE SET NULL,
  sort_order int DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE public.profile_entries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own profile entries"
  ON public.profile_entries FOR ALL
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Admins can view all profile entries"
  ON public.profile_entries FOR SELECT
  TO authenticated
  USING (public.is_admin(auth.uid()));

-- Agent instructions
CREATE TABLE public.agent_instructions (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  instruction text NOT NULL,
  applies_to text DEFAULT 'all',
  is_active boolean DEFAULT true,
  sort_order int DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE public.agent_instructions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own agent instructions"
  ON public.agent_instructions FOR ALL
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Admins can view all agent instructions"
  ON public.agent_instructions FOR SELECT
  TO authenticated
  USING (public.is_admin(auth.uid()));

-- Profile views
CREATE TABLE public.profile_views (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL,
  slug text NOT NULL,
  description text,
  included_scopes text[] NOT NULL DEFAULT '{all}',
  created_at timestamptz DEFAULT now(),
  UNIQUE(user_id, slug)
);

ALTER TABLE public.profile_views ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own profile views"
  ON public.profile_views FOR ALL
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Admins can view all profile views"
  ON public.profile_views FOR SELECT
  TO authenticated
  USING (public.is_admin(auth.uid()));

-- Updated_at triggers
CREATE TRIGGER update_profile_categories_updated_at
  BEFORE UPDATE ON public.profile_categories
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

CREATE TRIGGER update_profile_entries_updated_at
  BEFORE UPDATE ON public.profile_entries
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

CREATE TRIGGER update_agent_instructions_updated_at
  BEFORE UPDATE ON public.agent_instructions
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- Indexes
CREATE INDEX idx_profile_categories_user ON public.profile_categories(user_id);
CREATE INDEX idx_profile_entries_user ON public.profile_entries(user_id);
CREATE INDEX idx_profile_entries_category ON public.profile_entries(category_id);
CREATE INDEX idx_agent_instructions_user ON public.agent_instructions(user_id);
CREATE INDEX idx_profile_views_user ON public.profile_views(user_id);
