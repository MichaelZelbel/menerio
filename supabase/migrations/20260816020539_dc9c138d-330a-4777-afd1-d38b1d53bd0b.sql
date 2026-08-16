-- Profile field registry + canonicalization trigger
-- Enforces a closed vocabulary for structured categories, rewrites synonyms,
-- rejects garbage values, and merges list-valued duplicates at write time.

-- 1. Registry table
CREATE TABLE IF NOT EXISTS public.profile_fields (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
    category_slug text NOT NULL,
    canonical_label text NOT NULL,
    cardinality text NOT NULL DEFAULT 'list' CHECK (cardinality IN ('single', 'list')),
    value_type text NOT NULL DEFAULT 'text' CHECK (value_type IN ('text', 'date', 'number', 'boolean')),
    aliases text[] NOT NULL DEFAULT '{}',
    is_system boolean NOT NULL DEFAULT false,
    is_active boolean NOT NULL DEFAULT true,
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    updated_at timestamp with time zone NOT NULL DEFAULT now()
);

-- System fields are unique per category/label; user fields are unique per user/category/label.
CREATE UNIQUE INDEX IF NOT EXISTS idx_profile_fields_system_unique
    ON public.profile_fields (category_slug, canonical_label) WHERE user_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_profile_fields_user_unique
    ON public.profile_fields (user_id, category_slug, canonical_label) WHERE user_id IS NOT NULL;

-- 2. Grants
GRANT SELECT ON public.profile_fields TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.profile_fields TO authenticated;
GRANT ALL ON public.profile_fields TO service_role;

-- 3. RLS
ALTER TABLE public.profile_fields ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read system and own profile fields"
    ON public.profile_fields FOR SELECT
    TO authenticated
    USING (user_id IS NULL OR user_id = auth.uid());

CREATE POLICY "Users can manage own profile fields"
    ON public.profile_fields FOR ALL
    TO authenticated
    USING (user_id = auth.uid())
    WITH CHECK (user_id = auth.uid());

CREATE POLICY "Service role manages profile fields"
    ON public.profile_fields FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

-- 4. Trigger function
CREATE OR REPLACE FUNCTION public.profile_entry_canonicalize()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
    v_category_slug text;
    v_field record;
    v_canonical_label text;
    v_cardinality text;
    v_normalized_value text;
    v_name text;
    v_existing record;
    v_review_payload jsonb;
    v_value_lower text;
    v_existing_lower text;
    v_bool_filler text[] := ARRAY['yes','no','true','false','n/a','na','unknown','-','none','maybe','perhaps','unsure','not sure','idk'];
    v_stripped text;
    v_leading_verbs text[] := ARRAY['has','have','had','is','was','are','were','suffers from','diagnosed with'];
    v_parts text[];
    v_part text;
    v_seen text[];
    v_merged text[];
    v_norm text;
BEGIN
    -- Resolve category slug
    SELECT slug INTO v_category_slug
    FROM public.profile_categories
    WHERE id = NEW.category_id;

    IF v_category_slug IS NULL THEN
        RAISE EXCEPTION 'Invalid category_id %', NEW.category_id;
    END IF;

    -- Resolve subject name (for "value equals name" guard)
    IF NEW.contact_id IS NOT NULL THEN
        SELECT name INTO v_name FROM public.contacts WHERE id = NEW.contact_id;
    ELSE
        SELECT display_name INTO v_name FROM public.profiles WHERE id = NEW.user_id;
    END IF;

    -- Normalize incoming label
    v_canonical_label := regexp_replace(
        trim(NEW.label),
        '^[\p{P}\s]+|[\p{P}\s]+$',
        '',
        'gu'
    );

    -- Look up field in registry (user-specific overrides take precedence over system)
    SELECT * INTO v_field
    FROM public.profile_fields
    WHERE (user_id = NEW.user_id OR user_id IS NULL)
      AND category_slug = v_category_slug
      AND is_active = true
      AND (lower(canonical_label) = lower(v_canonical_label)
           OR lower(v_canonical_label) = ANY(ARRAY(SELECT lower(a) FROM unnest(aliases) AS a)))
    ORDER BY user_id NULLS LAST
    LIMIT 1;

    IF v_field IS NULL THEN
        -- Unknown label. If this category has system fields, it is "structured".
        IF EXISTS (
            SELECT 1 FROM public.profile_fields
            WHERE category_slug = v_category_slug AND is_system = true AND is_active = true
        ) THEN
            v_review_payload := jsonb_build_object(
                'label', NEW.label,
                'canonical_label', v_canonical_label,
                'value', NEW.value,
                'category_id', NEW.category_id,
                'category_slug', v_category_slug,
                'contact_id', NEW.contact_id,
                'linked_note_id', NEW.linked_note_id,
                'origin', NEW.origin,
                'evidence_quote', NEW.evidence_quote
            );

            INSERT INTO public.review_queue (
                user_id,
                source_note_id,
                suggestion_type,
                title,
                description,
                payload,
                target_entity_type,
                target_entity_id,
                extracted_value,
                status
            ) VALUES (
                NEW.user_id,
                NEW.linked_note_id,
                'unknown_profile_field',
                'New profile field: ' || NEW.label,
                NEW.value,
                v_review_payload,
                CASE WHEN NEW.contact_id IS NULL THEN 'self' ELSE 'contact' END,
                COALESCE(NEW.contact_id, NEW.user_id),
                NEW.value,
                'pending'
            );

            RETURN NULL; -- abort the write; the suggestion is now in the queue
        END IF;

        -- Open category: keep the label as-is, treat as list-valued text
        v_canonical_label := NEW.label;
        v_cardinality := 'list';
    ELSE
        v_canonical_label := v_field.canonical_label;
        v_cardinality := v_field.cardinality;
        NEW.label := v_canonical_label;
    END IF;

    -- Value quality gate
    v_normalized_value := lower(trim(NEW.value));

    -- Empty / trivial
    IF length(v_normalized_value) <= 1 THEN
        RETURN NULL;
    END IF;

    -- Boolean-ish filler
    IF v_normalized_value = ANY(v_bool_filler) THEN
        RETURN NULL;
    END IF;

    -- Strip one leading verb for the restatement check
    v_stripped := v_normalized_value;
    FOR i IN 1..array_length(v_leading_verbs, 1) LOOP
        IF v_stripped ~ ('^' || v_leading_verbs[i] || '\s+') THEN
            v_stripped := regexp_replace(v_stripped, ('^' || v_leading_verbs[i] || '\s+'), '', 'i');
            EXIT;
        END IF;
    END LOOP;

    -- Value restates the label (e.g. "Social anxiety: has social anxiety")
    IF lower(trim(v_stripped)) = lower(trim(v_canonical_label)) THEN
        RETURN NULL;
    END IF;

    -- Value is just the person's name
    IF v_name IS NOT NULL AND v_normalized_value = lower(trim(v_name)) THEN
        RETURN NULL;
    END IF;

    -- Semantic dedup against existing rows in the same category/same canonical label
    FOR v_existing IN
        SELECT id, value
        FROM public.profile_entries
        WHERE user_id = NEW.user_id
          AND contact_id IS NOT DISTINCT FROM NEW.contact_id
          AND category_id = NEW.category_id
          AND label = v_canonical_label
          AND id IS DISTINCT FROM NEW.id
    LOOP
        v_existing_lower := lower(regexp_replace(trim(v_existing.value), '\s+', ' ', 'g'));
        v_value_lower := lower(regexp_replace(trim(NEW.value), '\s+', ' ', 'g'));

        -- Exact duplicate: abort
        IF v_existing_lower = v_value_lower THEN
            RETURN NULL;
        END IF;

        -- Conservative subset collapse
        IF length(v_value_lower) >= 6
           AND length(v_existing_lower) > length(v_value_lower)
           AND v_existing_lower LIKE '%' || v_value_lower || '%' THEN
            RETURN NULL;
        END IF;
        IF length(v_existing_lower) >= 6
           AND length(v_value_lower) > length(v_existing_lower)
           AND v_value_lower LIKE '%' || v_existing_lower || '%' THEN
            UPDATE public.profile_entries
            SET value = NEW.value, updated_at = now()
            WHERE id = v_existing.id;
            RETURN NULL;
        END IF;
    END LOOP;

    -- Cardinality enforcement
    IF v_cardinality = 'single' THEN
        SELECT id, value INTO v_existing
        FROM public.profile_entries
        WHERE user_id = NEW.user_id
          AND contact_id IS NOT DISTINCT FROM NEW.contact_id
          AND category_id = NEW.category_id
          AND label = v_canonical_label
          AND id IS DISTINCT FROM NEW.id
        LIMIT 1;

        IF FOUND THEN
            UPDATE public.profile_entries
            SET value = NEW.value, updated_at = now()
            WHERE id = v_existing.id;
            RETURN NULL;
        END IF;
    END IF;

    -- List-valued merge: fold into one row per canonical label
    IF v_cardinality = 'list' THEN
        SELECT id, value INTO v_existing
        FROM public.profile_entries
        WHERE user_id = NEW.user_id
          AND contact_id IS NOT DISTINCT FROM NEW.contact_id
          AND category_id = NEW.category_id
          AND label = v_canonical_label
          AND id IS DISTINCT FROM NEW.id
        LIMIT 1;

        IF FOUND THEN
            v_seen := ARRAY[]::text[];
            v_merged := ARRAY[]::text[];

            v_parts := string_to_array(trim(v_existing.value), ',');
            FOR i IN 1..coalesce(array_length(v_parts, 1), 0) LOOP
                v_part := trim(v_parts[i]);
                IF length(v_part) = 0 THEN CONTINUE; END IF;
                v_norm := lower(regexp_replace(v_part, '\s+', ' ', 'g'));
                IF NOT (v_norm = ANY(v_seen)) THEN
                    v_seen := array_append(v_seen, v_norm);
                    v_merged := array_append(v_merged, v_part);
                END IF;
            END LOOP;

            v_parts := string_to_array(trim(NEW.value), ',');
            FOR i IN 1..coalesce(array_length(v_parts, 1), 0) LOOP
                v_part := trim(v_parts[i]);
                IF length(v_part) = 0 THEN CONTINUE; END IF;
                v_norm := lower(regexp_replace(v_part, '\s+', ' ', 'g'));
                IF NOT (v_norm = ANY(v_seen)) THEN
                    v_seen := array_append(v_seen, v_norm);
                    v_merged := array_append(v_merged, v_part);
                END IF;
            END LOOP;

            IF array_length(v_merged, 1) > 0 THEN
                UPDATE public.profile_entries
                SET value = array_to_string(v_merged, ', '),
                    updated_at = now()
                WHERE id = v_existing.id;
            END IF;
            RETURN NULL;
        END IF;
    END IF;

    -- Clean value before allowing the write
    NEW.value := trim(NEW.value);
    RETURN NEW;
END;
$$;

-- 5. Attach trigger
DROP TRIGGER IF EXISTS trg_profile_entries_canonicalize ON public.profile_entries;
CREATE TRIGGER trg_profile_entries_canonicalize
    BEFORE INSERT OR UPDATE ON public.profile_entries
    FOR EACH ROW
    EXECUTE FUNCTION public.profile_entry_canonicalize();

-- 6. Seed system fields from the canonical schema
INSERT INTO public.profile_fields (user_id, category_slug, canonical_label, cardinality, value_type, aliases, is_system) VALUES
    (NULL, 'identity', 'Full name', 'single', 'text', ARRAY['legal name', 'name', 'full legal name']::text[], true),
    (NULL, 'identity', 'Preferred name', 'single', 'text', ARRAY['first name', 'goes by', 'preferred name']::text[], true),
    (NULL, 'identity', 'Nickname', 'list', 'text', ARRAY['nickname', 'nicknames', 'nick name', 'alias', 'aliases', 'name alias', 'name aliases', 'alternative name', 'alternative names', 'alternate name', 'other name', 'other names', 'also called', 'handle', 'pet name', 'aka', 'a.k.a.', 'also known as', 'known as', 'goes by', 'short name', 'familiar name']::text[], true),
    (NULL, 'identity', 'Date of birth', 'single', 'text', ARRAY['birthday', 'dob', 'born on', 'geburtsdatum', 'geburtstag', 'date of birth', 'birth date']::text[], true),
    (NULL, 'identity', 'Place of birth', 'single', 'text', ARRAY['birthplace', 'born in', 'place of birth']::text[], true),
    (NULL, 'identity', 'Nationality', 'list', 'text', ARRAY['citizenship', 'nationality']::text[], true),
    (NULL, 'identity', 'Gender', 'single', 'text', ARRAY['gender']::text[], true),
    (NULL, 'identity', 'Pronouns', 'single', 'text', ARRAY['pronouns']::text[], true),
    (NULL, 'identity', 'Marital status', 'single', 'text', ARRAY['marital status']::text[], true),
    (NULL, 'identity', 'Maiden name', 'single', 'text', ARRAY['nee', 'née', 'birth surname', 'maiden name']::text[], true),
    (NULL, 'identity', 'Married surname', 'single', 'text', ARRAY['married name', 'married surname']::text[], true),
    (NULL, 'identity', 'Religion', 'single', 'text', ARRAY['faith', 'religion']::text[], true),
    (NULL, 'identity', 'Height', 'single', 'text', ARRAY['height', 'körpergröße', 'koerpergroesse', 'größe']::text[], true),
    (NULL, 'identity', 'Eye color', 'single', 'text', ARRAY['eye color', 'eye colour', 'augenfarbe']::text[], true),
    (NULL, 'identity', 'Hair color', 'single', 'text', ARRAY['hair color', 'hair colour', 'haarfarbe']::text[], true),
    (NULL, 'identity', 'Blood type', 'single', 'text', ARRAY['blood type', 'blood group', 'blutgruppe']::text[], true),
    (NULL, 'identity', 'Pronunciation', 'single', 'text', ARRAY['pronunciation', 'name pronunciation', 'pronounced']::text[], true),
    (NULL, 'identity', 'Language', 'list', 'text', ARRAY['language', 'languages', 'speaks', 'spoken languages']::text[], true),
    (NULL, 'location', 'Current street', 'single', 'text', ARRAY['street', 'street address', 'current street', 'strasse', 'straße']::text[], true),
    (NULL, 'location', 'Postal code', 'single', 'text', ARRAY['postal code', 'zip', 'zip code', 'postcode', 'plz']::text[], true),
    (NULL, 'location', 'Current city', 'single', 'text', ARRAY['city', 'lives in', 'based in', 'located in', 'current city']::text[], true),
    (NULL, 'location', 'Current country', 'single', 'text', ARRAY['country', 'current country']::text[], true),
    (NULL, 'location', 'Previous city', 'list', 'text', ARRAY['former city', 'used to live in', 'previous city']::text[], true),
    (NULL, 'location', 'Timezone', 'single', 'text', ARRAY['timezone', 'time zone']::text[], true),
    (NULL, 'location', 'Living situation', 'single', 'text', ARRAY['living situation', 'housing']::text[], true),
    (NULL, 'professional', 'Job title', 'single', 'text', ARRAY['role', 'title', 'position', 'current role', 'job title', 'current job title']::text[], true),
    (NULL, 'professional', 'Employer', 'single', 'text', ARRAY['company', 'current company', 'works at', 'organization', 'employer']::text[], true),
    (NULL, 'professional', 'Industry', 'single', 'text', ARRAY['sector', 'field', 'industry']::text[], true),
    (NULL, 'professional', 'Previous employer', 'list', 'text', ARRAY['former company', 'ex-employer', 'previous employer', 'former employer']::text[], true),
    (NULL, 'professional', 'Skill', 'list', 'text', ARRAY['skill', 'skills', 'expertise', 'specialty', 'competency']::text[], true),
    (NULL, 'professional', 'Tool / platform', 'list', 'text', ARRAY['tool', 'tools', 'platform', 'platforms', 'software used', 'tech stack', 'tool / platform']::text[], true),
    (NULL, 'professional', 'Topic of interest', 'list', 'text', ARRAY['topic', 'topics', 'topic of interest', 'focus area', 'focus areas', 'domain']::text[], true),
    (NULL, 'professional', 'Years of experience', 'single', 'text', ARRAY['years of experience']::text[], true),
    (NULL, 'professional', 'Professional summary', 'single', 'text', ARRAY['bio', 'headline', 'about', 'professional summary']::text[], true),
    (NULL, 'education', 'Degree', 'list', 'text', ARRAY['qualification', 'diploma', 'degree']::text[], true),
    (NULL, 'education', 'Field of study', 'list', 'text', ARRAY['major', 'subject', 'field of study']::text[], true),
    (NULL, 'education', 'School', 'list', 'text', ARRAY['university', 'college', 'institution', 'alma mater', 'school']::text[], true),
    (NULL, 'education', 'Graduation year', 'list', 'text', ARRAY['graduation year']::text[], true),
    (NULL, 'education', 'Certification', 'list', 'text', ARRAY['certificate', 'credential', 'license', 'certification']::text[], true),
    (NULL, 'relationships', 'How we met', 'list', 'text', ARRAY['how we met']::text[], true),
    (NULL, 'relationships', 'Wedding date', 'single', 'text', ARRAY['marriage date', 'wedding anniversary', 'anniversary (marriage)', 'hochzeitstag', 'wedding date']::text[], true),
    (NULL, 'relationships', 'Wedding location', 'single', 'text', ARRAY['marriage location', 'married in', 'wedding location']::text[], true),
    (NULL, 'relationships', 'Anniversary', 'single', 'text', ARRAY['anniversary']::text[], true),
    (NULL, 'communication', 'Email', 'list', 'text', ARRAY['email', 'email address', 'e-mail']::text[], true),
    (NULL, 'communication', 'Phone', 'list', 'text', ARRAY['phone', 'mobile', 'cell', 'telephone', 'number']::text[], true),
    (NULL, 'communication', 'Preferred channel', 'single', 'text', ARRAY['best way to reach', 'preferred channel']::text[], true),
    (NULL, 'communication', 'Social handle', 'list', 'text', ARRAY['social handle', 'linkedin', 'x', 'twitter', 'instagram', 'discord', 'telegram', 'whatsapp']::text[], true),
    (NULL, 'communication', 'Website', 'list', 'text', ARRAY['website', 'url', 'homepage', 'blog', 'linktree']::text[], true),
    (NULL, 'financial', 'Income', 'single', 'text', ARRAY['salary', 'earnings', 'income']::text[], true),
    (NULL, 'financial', 'Currency', 'single', 'text', ARRAY['currency']::text[], true),
    (NULL, 'financial', 'Payment method', 'list', 'text', ARRAY['ko-fi', 'paypal', 'bank', 'payment method']::text[], true),
    (NULL, 'financial', 'Account / asset', 'list', 'text', ARRAY['account', 'asset', 'account / asset']::text[], true),
    (NULL, 'food', 'Favorite foods', 'list', 'text', ARRAY['favorite food/drink', 'favorite dish', 'favorite cuisine', 'favorite dishes', 'favorite food', 'favorite cuisines']::text[], true),
    (NULL, 'food', 'Favorite drinks', 'list', 'text', ARRAY['favorite drink', 'favorite beverages', 'favorite beverage']::text[], true),
    (NULL, 'food', 'Favorite desserts', 'list', 'text', ARRAY['favorite dessert']::text[], true),
    (NULL, 'food', 'Favorite snacks', 'list', 'text', ARRAY['favorite snack']::text[], true),
    (NULL, 'food', 'Favorite fruits', 'list', 'text', ARRAY['favorite fruit']::text[], true),
    (NULL, 'food', 'Favorite restaurants', 'list', 'text', ARRAY['favorite restaurant']::text[], true),
    (NULL, 'entertainment', 'Favorite songs', 'list', 'text', ARRAY['favorite song']::text[], true),
    (NULL, 'entertainment', 'Favorite movies', 'list', 'text', ARRAY['favorite movie', 'favorite film', 'favorite films']::text[], true),
    (NULL, 'entertainment', 'Favorite TV shows', 'list', 'text', ARRAY['favorite tv show', 'favorite shows', 'favorite show']::text[], true),
    (NULL, 'entertainment', 'Favorite music artists', 'list', 'text', ARRAY['favorite artists', 'favorite music artist', 'favorite bands', 'favorite band', 'favorite artist']::text[], true),
    (NULL, 'entertainment', 'Favorite characters', 'list', 'text', ARRAY['favorite character']::text[], true),
    (NULL, 'entertainment', 'Favorite YouTubers', 'list', 'text', ARRAY['favorite youtuber']::text[], true),
    (NULL, 'entertainment', 'Favorite places', 'list', 'text', ARRAY['favorite place']::text[], true),
    (NULL, 'personality', 'Love language', 'list', 'text', ARRAY['love language(s)', 'love languages']::text[], true),
    (NULL, 'open', 'Ethnicity', 'list', 'text', ARRAY['ethnic background']::text[], true),
    (NULL, 'health', 'Allergies', 'list', 'text', ARRAY['allergens', 'food allergy', 'allergy', 'food allergies', 'allergen', 'allergic to']::text[], true),
    (NULL, 'health', 'Health conditions', 'list', 'text', ARRAY['diagnosis', 'condition', 'health issues', 'diagnoses', 'physical health conditions', 'medical conditions', 'chronic condition', 'chronic conditions', 'medical condition', 'mental health conditions', 'health issue', 'mental health condition', 'health condition', 'physical health condition']::text[], true),
    (NULL, 'health', 'Medications', 'list', 'text', ARRAY['current medication', 'current medications', 'medication']::text[], true),
    (NULL, 'health', 'Hospitalization history', 'list', 'text', ARRAY['hospitalisation history', 'history of hospitalization']::text[], true),
    (NULL, 'digital', 'VRChat activities', 'list', 'text', ARRAY['vrchat activity']::text[], true),
    (NULL, 'entertainment', 'Favorite games', 'list', 'text', ARRAY['favorite game']::text[], true),
    (NULL, 'hobbies', 'Hobbies', 'list', 'text', ARRAY['hobby']::text[], true),
    (NULL, 'hobbies', 'Pets', 'list', 'text', ARRAY['pet']::text[], true),
    (NULL, 'hobbies', 'Routine', 'list', 'text', ARRAY[]::text[], true),
    (NULL, 'hobbies', 'Daily routine', 'list', 'text', ARRAY[]::text[], true),
    (NULL, 'hobbies', 'Work arrangement', 'list', 'text', ARRAY[]::text[], true)
ON CONFLICT (category_slug, canonical_label) WHERE user_id IS NULL DO UPDATE SET
    cardinality = EXCLUDED.cardinality,
    value_type = EXCLUDED.value_type,
    aliases = EXCLUDED.aliases,
    is_system = true,
    is_active = true,
    updated_at = now();