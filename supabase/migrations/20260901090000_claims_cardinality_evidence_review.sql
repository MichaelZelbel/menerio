-- Three columns the claims table needs before it can be trusted as the fact store.
--
-- cardinality    says whether an attribute holds one live value or several.
--                Without it, contradiction detection flags every multi-value
--                attribute and becomes noise nobody reads. Measured on the hub
--                mirror 2026-08-30: of 8 subject+attribute collisions, at least
--                two were legitimate multi-value attributes.
--
-- evidence_quote is the sentence the fact came from. "subject attribute value"
--                is three or four words with almost no language in it, so a
--                vector built from it matches badly. The quote is what a person
--                would actually search with.
--
-- review_by      is PROSPECTIVE: when to doubt this fact. valid_to is
--                retrospective, recording when it stopped being true, which you
--                only learn afterwards. Nothing in agent memory has this
--                (checked against Graphiti, Zep and arXiv 2606.26511 on
--                2026-08-30), which is why it gets measured rather than assumed.

ALTER TABLE public.claims
  ADD COLUMN IF NOT EXISTS cardinality text NOT NULL DEFAULT 'one'
    CHECK (cardinality IN ('one', 'many')),
  ADD COLUMN IF NOT EXISTS evidence_quote text,
  ADD COLUMN IF NOT EXISTS review_by date;

COMMENT ON COLUMN public.claims.cardinality IS
  'one = a second live value is a contradiction. many = several live values are normal.';
COMMENT ON COLUMN public.claims.evidence_quote IS
  'The sentence this fact came from. Gives vector search language to match on.';
COMMENT ON COLUMN public.claims.review_by IS
  'When to re-check this fact. NULL = never needs re-checking (a birth date).';

-- Partial index: only live claims that can go stale are ever queried this way.
CREATE INDEX IF NOT EXISTS claims_review_by_idx
  ON public.claims (user_id, review_by)
  WHERE review_by IS NOT NULL AND valid_to IS NULL;

-- The registries, so the database agrees with supabase/functions/_shared/claims.ts
-- and src/lib/claims.ts. Keys are normalizeAttribute output: lowercase, dashed.
CREATE TABLE IF NOT EXISTS public.attribute_rules (
  attribute text PRIMARY KEY,
  cardinality text NOT NULL DEFAULT 'one' CHECK (cardinality IN ('one', 'many')),
  review_days int,                       -- NULL = never needs re-checking
  created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.attribute_rules IS
  'How each attribute behaves. Mirrors the two TypeScript copies; keep all three in sync.';

INSERT INTO public.attribute_rules (attribute, cardinality, review_days) VALUES
  -- many-valued: several live answers at once are normal, never a contradiction
  ('favorite-restaurants', 'many', 365),
  ('favorite-colors',      'many', NULL),
  ('favorite-animals',     'many', NULL),
  ('favorite-pokemon',     'many', NULL),
  ('favorite-games',       'many', 365),
  ('investments',          'many', 365),
  ('pets',                 'many', 365),
  ('hobbies',              'many', 365),
  ('languages',            'many', NULL),
  ('symptoms',             'many', 30),
  ('life-events',          'many', NULL),
  ('health-conditions',    'many', 90),
  ('skills',               'many', 365),
  ('email',                'many', 730),
  ('social-handle',        'many', 730),
  -- single-valued that never needs re-checking
  ('date-of-birth',        'one',  NULL),
  ('birthplace',           'one',  NULL),
  ('wedding-date',         'one',  NULL),
  ('gender',               'one',  NULL),
  ('ethnicity',            'one',  NULL),
  ('full-name',            'one',  NULL),
  ('nationality',          'one',  NULL),
  ('pronouns',             'one',  NULL),
  -- single-valued that goes stale, fastest first
  ('duolingo-streak',      'one',  14),
  ('body-weight',          'one',  14),
  ('fitness-goal',         'one',  90),
  ('health-status',        'one',  90),
  -- the manager split Michael confirmed 2026-08-31: neither value was wrong,
  -- the attribute name was too coarse and covered two different facts.
  ('line-manager',         'one',  180),
  ('manager-in-project',   'one',  180),
  ('manager',              'one',  180),
  ('job-title',            'one',  365),
  ('employer',             'one',  365),
  ('current-city',         'one',  365),
  ('current-street',       'one',  365),
  ('location',             'one',  365),
  ('phone',                'one',  730),
  ('website',              'one',  730)
ON CONFLICT (attribute) DO NOTHING;

GRANT SELECT ON public.attribute_rules TO authenticated, service_role;
ALTER TABLE public.attribute_rules ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone signed in may read the attribute rules" ON public.attribute_rules;
CREATE POLICY "Anyone signed in may read the attribute rules"
  ON public.attribute_rules FOR SELECT TO authenticated USING (true);
