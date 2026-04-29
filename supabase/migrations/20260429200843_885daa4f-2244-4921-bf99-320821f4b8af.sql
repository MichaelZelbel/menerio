CREATE TABLE IF NOT EXISTS public.collections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL,
  slug text NOT NULL,
  icon text,
  description text,
  field_schema jsonb NOT NULL DEFAULT '[]'::jsonb,
  agent_instructions text,
  visibility text NOT NULL DEFAULT 'private' CHECK (visibility IN ('private', 'personal', 'shared')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, slug)
);

CREATE TABLE IF NOT EXISTS public.collection_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  collection_id uuid NOT NULL REFERENCES public.collections(id) ON DELETE CASCADE,
  title text,
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  indexable_date_1 date,
  indexable_date_2 date,
  indexable_number_1 numeric,
  indexable_number_2 numeric,
  indexable_text_1 text,
  search_vector tsvector,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.collection_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  slug text NOT NULL UNIQUE,
  description text,
  icon text,
  category text,
  field_schema jsonb NOT NULL,
  agent_instructions text,
  official boolean NOT NULL DEFAULT true,
  usage_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.collections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.collection_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.collection_templates ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.slugify_collection_name(p_name text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT COALESCE(NULLIF(regexp_replace(regexp_replace(lower(trim(COALESCE(p_name, 'collection'))), '[^a-z0-9]+', '-', 'g'), '^-+|-+$', '', 'g'), ''), 'collection')
$$;

CREATE OR REPLACE FUNCTION public.set_collection_slug()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_base_slug text;
  v_candidate text;
BEGIN
  IF NEW.slug IS NULL OR btrim(NEW.slug) = '' THEN
    v_base_slug := public.slugify_collection_name(NEW.name);
    v_candidate := v_base_slug;

    IF EXISTS (
      SELECT 1 FROM public.collections
      WHERE user_id = NEW.user_id
        AND slug = v_candidate
        AND id IS DISTINCT FROM NEW.id
    ) THEN
      v_candidate := v_base_slug || '-' || lower(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6));
    END IF;

    NEW.slug := v_candidate;
  ELSE
    NEW.slug := public.slugify_collection_name(NEW.slug);
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.sync_collection_item_indexable_columns()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_schema jsonb;
  v_field jsonb;
  v_key text;
  v_type text;
  v_value jsonb;
  v_text text;
  v_date_count integer := 0;
  v_number_count integer := 0;
  v_text_count integer := 0;
  v_primary_key text;
  v_fallback_text_key text;
  v_search_text text;
BEGIN
  SELECT field_schema INTO v_schema
  FROM public.collections
  WHERE id = NEW.collection_id
    AND user_id = NEW.user_id;

  IF v_schema IS NULL THEN
    RAISE EXCEPTION 'collection not found for item';
  END IF;

  NEW.indexable_date_1 := NULL;
  NEW.indexable_date_2 := NULL;
  NEW.indexable_number_1 := NULL;
  NEW.indexable_number_2 := NULL;
  NEW.indexable_text_1 := NULL;

  FOR v_field IN SELECT * FROM jsonb_array_elements(v_schema)
  LOOP
    v_key := v_field->>'key';
    v_type := COALESCE(v_field->>'type', 'text');

    IF COALESCE((v_field->>'primary')::boolean, false) AND v_primary_key IS NULL THEN
      v_primary_key := v_key;
    END IF;

    IF v_type IN ('text', 'longtext') AND v_fallback_text_key IS NULL THEN
      v_fallback_text_key := v_key;
    END IF;

    IF COALESCE((v_field->>'indexable')::boolean, false) AND v_key IS NOT NULL THEN
      v_value := NEW.data -> v_key;
      v_text := NULLIF(trim(BOTH '"' FROM v_value::text), 'null');

      IF v_value IS NOT NULL AND v_value <> 'null'::jsonb AND v_text IS NOT NULL THEN
        IF v_type = 'date' AND v_date_count < 2 THEN
          BEGIN
            v_date_count := v_date_count + 1;
            IF v_date_count = 1 THEN
              NEW.indexable_date_1 := v_text::date;
            ELSE
              NEW.indexable_date_2 := v_text::date;
            END IF;
          EXCEPTION WHEN OTHERS THEN
            v_date_count := GREATEST(v_date_count - 1, 0);
          END;
        ELSIF v_type = 'number' AND v_number_count < 2 THEN
          BEGIN
            v_number_count := v_number_count + 1;
            IF v_number_count = 1 THEN
              NEW.indexable_number_1 := v_text::numeric;
            ELSE
              NEW.indexable_number_2 := v_text::numeric;
            END IF;
          EXCEPTION WHEN OTHERS THEN
            v_number_count := GREATEST(v_number_count - 1, 0);
          END;
        ELSIF v_type IN ('text', 'select') AND v_text_count < 1 THEN
          v_text_count := v_text_count + 1;
          NEW.indexable_text_1 := v_text;
        END IF;
      END IF;
    END IF;
  END LOOP;

  NEW.title := COALESCE(
    NULLIF(trim(BOTH '"' FROM (NEW.data -> v_primary_key)::text), 'null'),
    NULLIF(trim(BOTH '"' FROM (NEW.data -> v_fallback_text_key)::text), 'null'),
    'Untitled'
  );

  SELECT string_agg(value, ' ') INTO v_search_text
  FROM jsonb_each_text(NEW.data);

  NEW.search_vector := to_tsvector('simple', COALESCE(v_search_text, ''));

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS set_collections_updated_at ON public.collections;
CREATE TRIGGER set_collections_updated_at
BEFORE UPDATE ON public.collections
FOR EACH ROW
EXECUTE FUNCTION public.handle_updated_at();

DROP TRIGGER IF EXISTS set_collection_items_updated_at ON public.collection_items;
CREATE TRIGGER set_collection_items_updated_at
BEFORE UPDATE ON public.collection_items
FOR EACH ROW
EXECUTE FUNCTION public.handle_updated_at();

DROP TRIGGER IF EXISTS set_collection_slug_before_insert ON public.collections;
CREATE TRIGGER set_collection_slug_before_insert
BEFORE INSERT ON public.collections
FOR EACH ROW
EXECUTE FUNCTION public.set_collection_slug();

DROP TRIGGER IF EXISTS sync_collection_item_indexable_columns_before_write ON public.collection_items;
CREATE TRIGGER sync_collection_item_indexable_columns_before_write
BEFORE INSERT OR UPDATE ON public.collection_items
FOR EACH ROW
EXECUTE FUNCTION public.sync_collection_item_indexable_columns();

CREATE INDEX IF NOT EXISTS idx_collections_field_schema ON public.collections USING gin (field_schema);
CREATE INDEX IF NOT EXISTS idx_collection_items_data ON public.collection_items USING gin (data);
CREATE INDEX IF NOT EXISTS idx_collection_items_search_vector ON public.collection_items USING gin (search_vector);
CREATE INDEX IF NOT EXISTS idx_collection_items_indexable_date_1 ON public.collection_items (indexable_date_1);
CREATE INDEX IF NOT EXISTS idx_collection_items_indexable_date_2 ON public.collection_items (indexable_date_2);
CREATE INDEX IF NOT EXISTS idx_collection_items_indexable_number_1 ON public.collection_items (indexable_number_1);
CREATE INDEX IF NOT EXISTS idx_collection_items_indexable_number_2 ON public.collection_items (indexable_number_2);
CREATE INDEX IF NOT EXISTS idx_collection_items_indexable_text_1 ON public.collection_items (indexable_text_1);
CREATE INDEX IF NOT EXISTS idx_collection_items_collection_id ON public.collection_items (collection_id);
CREATE INDEX IF NOT EXISTS idx_collection_items_user_id ON public.collection_items (user_id);

DROP POLICY IF EXISTS "Users can view their own collections" ON public.collections;
CREATE POLICY "Users can view their own collections"
ON public.collections
FOR SELECT
TO authenticated
USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can create their own collections" ON public.collections;
CREATE POLICY "Users can create their own collections"
ON public.collections
FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update their own collections" ON public.collections;
CREATE POLICY "Users can update their own collections"
ON public.collections
FOR UPDATE
TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete their own collections" ON public.collections;
CREATE POLICY "Users can delete their own collections"
ON public.collections
FOR DELETE
TO authenticated
USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can view their own collection items" ON public.collection_items;
CREATE POLICY "Users can view their own collection items"
ON public.collection_items
FOR SELECT
TO authenticated
USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can create their own collection items" ON public.collection_items;
CREATE POLICY "Users can create their own collection items"
ON public.collection_items
FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update their own collection items" ON public.collection_items;
CREATE POLICY "Users can update their own collection items"
ON public.collection_items
FOR UPDATE
TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete their own collection items" ON public.collection_items;
CREATE POLICY "Users can delete their own collection items"
ON public.collection_items
FOR DELETE
TO authenticated
USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Authenticated users can view collection templates" ON public.collection_templates;
CREATE POLICY "Authenticated users can view collection templates"
ON public.collection_templates
FOR SELECT
TO authenticated
USING (true);

INSERT INTO public.collection_templates (name, slug, description, icon, category, field_schema, agent_instructions, official)
VALUES
(
  'Household Knowledge',
  'household-knowledge',
  'Paint colors, appliance models, measurements, and other household facts you forget',
  '🏠',
  'home',
  '[{"key":"name","label":"Item","type":"text","primary":true},{"key":"category","label":"Category","type":"select","options":["paint","appliance","measurement","document","other"],"indexable":true},{"key":"location","label":"Location","type":"text"},{"key":"brand","label":"Brand / Model","type":"text"},{"key":"purchase_date","label":"Purchased","type":"date","indexable":true},{"key":"notes","label":"Notes","type":"longtext"}]'::jsonb,
  'This collection stores household facts the user wants to remember — paint colors, appliance models, measurements, warranties. When the user mentions one of these in conversation (a paint brand, a model number, a measurement, an item they bought for the house), offer to add an entry. Always capture brand/model and purchase date if available. Confirm before the first capture in a session.',
  true
),
(
  'Reading List',
  'reading-list',
  'Books you''re reading, want to read, or finished',
  '📚',
  'personal',
  '[{"key":"title","label":"Title","type":"text","primary":true},{"key":"author","label":"Author","type":"text"},{"key":"status","label":"Status","type":"select","options":["want to read","reading","finished","abandoned"],"indexable":true},{"key":"started","label":"Started","type":"date","indexable":true},{"key":"finished","label":"Finished","type":"date"},{"key":"rating","label":"Rating","type":"number"},{"key":"tags","label":"Tags","type":"multiselect","options":["fiction","nonfiction","biography","technical","philosophy","fantasy","scifi"]},{"key":"notes","label":"Notes","type":"longtext"}]'::jsonb,
  'This collection tracks the user''s reading. When they mention a book — starting one, finishing one, recommending one, or wanting to read one — offer to add or update an entry. Extract title and author. Ask the user for the status if it''s not obvious from context. Don''t fabricate ratings; only set rating when the user volunteers one.',
  true
)
ON CONFLICT (slug) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  icon = EXCLUDED.icon,
  category = EXCLUDED.category,
  field_schema = EXCLUDED.field_schema,
  agent_instructions = EXCLUDED.agent_instructions,
  official = EXCLUDED.official;
