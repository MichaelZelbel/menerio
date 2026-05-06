
-- 1. Self aliases table
CREATE TABLE public.user_self_aliases (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  alias TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, alias)
);

CREATE INDEX idx_user_self_aliases_user ON public.user_self_aliases(user_id) WHERE is_active = true;

ALTER TABLE public.user_self_aliases ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users select own self aliases" ON public.user_self_aliases
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "users insert own self aliases" ON public.user_self_aliases
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "users update own self aliases" ON public.user_self_aliases
  FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "users delete own self aliases" ON public.user_self_aliases
  FOR DELETE USING (auth.uid() = user_id);

CREATE TRIGGER trg_user_self_aliases_updated_at
  BEFORE UPDATE ON public.user_self_aliases
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- 2. Disambiguation memory
CREATE TABLE public.name_disambiguation_decisions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  alias_lower TEXT NOT NULL,
  context_kind TEXT NOT NULL DEFAULT 'global',
  target TEXT NOT NULL CHECK (target IN ('self', 'contact', 'ignore')),
  target_contact_id UUID NULL,
  confidence NUMERIC NOT NULL DEFAULT 0.5,
  decision_count INTEGER NOT NULL DEFAULT 1,
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, alias_lower, context_kind, target, target_contact_id)
);

CREATE INDEX idx_name_disambig_lookup ON public.name_disambiguation_decisions(user_id, alias_lower);

ALTER TABLE public.name_disambiguation_decisions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users select own disambig" ON public.name_disambiguation_decisions
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "users insert own disambig" ON public.name_disambiguation_decisions
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "users update own disambig" ON public.name_disambiguation_decisions
  FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "users delete own disambig" ON public.name_disambiguation_decisions
  FOR DELETE USING (auth.uid() = user_id);

CREATE TRIGGER trg_name_disambig_updated_at
  BEFORE UPDATE ON public.name_disambiguation_decisions
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- 3. Profile flag
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS self_matching_enabled BOOLEAN NOT NULL DEFAULT true;
