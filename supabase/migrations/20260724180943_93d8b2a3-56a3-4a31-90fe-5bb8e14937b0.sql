
-- ========================================================================
-- General profile deduplication: accumulator labels + synonym folding
-- Applies globally to every user, every contact, every write path.
-- ========================================================================

-- 1. Expand canonical label map with common synonyms observed in real data.
CREATE OR REPLACE FUNCTION public.profile_canonical_label(t text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  SELECT CASE public.profile_norm_label(t)
    -- Projects / work
    WHEN 'project' THEN 'project'
    WHEN 'projects' THEN 'project'
    WHEN 'current project' THEN 'project'
    WHEN 'current projects' THEN 'project'
    WHEN 'active project' THEN 'project'
    WHEN 'ongoing project' THEN 'project'
    WHEN 'side project' THEN 'project'
    WHEN 'product' THEN 'project'
    WHEN 'products' THEN 'project'
    WHEN 'book project' THEN 'project'
    WHEN 'book projects' THEN 'project'
    WHEN 'book' THEN 'project'
    WHEN 'books' THEN 'project'
    WHEN 'books written' THEN 'project'

    -- Goals
    WHEN 'goal' THEN 'goal'
    WHEN 'goals' THEN 'goal'
    WHEN 'life goal' THEN 'goal'
    WHEN 'life goals' THEN 'goal'
    WHEN 'personal goal' THEN 'goal'
    WHEN 'financial goal' THEN 'financial goal'
    WHEN 'financial goals' THEN 'financial goal'
    WHEN 'financial freedom' THEN 'financial goal'
    WHEN 'money goal' THEN 'financial goal'
    WHEN 'wealth goal' THEN 'financial goal'

    -- Hobbies / activities
    WHEN 'hobby' THEN 'hobby'
    WHEN 'hobbies' THEN 'hobby'
    WHEN 'favorite hobbies' THEN 'hobby'
    WHEN 'mentioned hobby' THEN 'hobby'
    WHEN 'hobby activity' THEN 'hobby'
    WHEN 'activity' THEN 'hobby'
    WHEN 'activities' THEN 'hobby'
    WHEN 'interest' THEN 'hobby'
    WHEN 'interests' THEN 'hobby'

    -- Web / social
    WHEN 'website' THEN 'website'
    WHEN 'websites' THEN 'website'
    WHEN 'social handle' THEN 'social handle'
    WHEN 'social handles' THEN 'social handle'
    WHEN 'social media' THEN 'social handle'
    WHEN 'social profile' THEN 'social handle'

    -- Skills / work-adjacent
    WHEN 'skill' THEN 'skill'
    WHEN 'skills' THEN 'skill'
    WHEN 'certification' THEN 'certification'
    WHEN 'certifications' THEN 'certification'
    WHEN 'open source contribution' THEN 'open source contribution'
    WHEN 'open source contributions' THEN 'open source contribution'
    WHEN 'job task' THEN 'job task'
    WHEN 'job tasks' THEN 'job task'
    WHEN 'affirmation' THEN 'affirmation'
    WHEN 'affirmations' THEN 'affirmation'
    WHEN 'self description' THEN 'self description'
    WHEN 'self descriptions' THEN 'self description'

    -- Health
    WHEN 'health issue' THEN 'health conditions'
    WHEN 'health issues' THEN 'health conditions'
    WHEN 'health condition' THEN 'health conditions'
    WHEN 'health conditions' THEN 'health conditions'
    WHEN 'mental health diagnoses' THEN 'health conditions'
    WHEN 'physical condition' THEN 'health conditions'
    WHEN 'suspected condition' THEN 'health conditions'
    WHEN 'medical history' THEN 'medical history'
    WHEN 'hospitalization history' THEN 'medical history'
    WHEN 'allergy' THEN 'allergies'
    WHEN 'allergies' THEN 'allergies'
    WHEN 'dislikes' THEN 'dislikes'
    WHEN 'dislike' THEN 'dislikes'

    -- Preserve existing mappings from previous migration
    WHEN 'moved out at age' THEN 'moved out at age'
    WHEN 'age moved out' THEN 'moved out at age'
    WHEN 'full name japanese' THEN 'japanese name'
    WHEN 'japanese name' THEN 'japanese name'
    WHEN 'full name brazilian' THEN 'brazilian name'
    WHEN 'brazilian name' THEN 'brazilian name'
    WHEN 'vrchat identity' THEN 'vrchat identity'
    WHEN 'vrchat persona' THEN 'vrchat identity'
    WHEN 'vrchat setup' THEN 'vrchat setup'
    WHEN 'vrchat equipment' THEN 'vrchat setup'
    WHEN 'vr equipment' THEN 'vrchat setup'
    WHEN 'vrchat activities' THEN 'vrchat setup'
    WHEN 'vrchat hobbies' THEN 'vrchat setup'
    WHEN 'full body tracking' THEN 'vrchat setup'
    WHEN 'vrchat avatar creators' THEN 'vrchat avatar creators'
    WHEN 'favorite avatar creators' THEN 'vrchat avatar creators'
    WHEN 'favorite music' THEN 'favorite artists'
    WHEN 'favorite music artists' THEN 'favorite artists'
    WHEN 'favorite musician band' THEN 'favorite artists'
    WHEN 'favorite musicians' THEN 'favorite artists'
    WHEN 'favorite artists' THEN 'favorite artists'
    WHEN 'favorite food' THEN 'favorite food'
    WHEN 'favorite foods' THEN 'favorite food'
    WHEN 'favorite foods and drinks' THEN 'favorite food'
    WHEN 'favorite fast food' THEN 'favorite food'
    WHEN 'favorite cuisine' THEN 'favorite food'
    WHEN 'favorite cuisines' THEN 'favorite food'
    WHEN 'favorite dish' THEN 'favorite food'
    WHEN 'favorite dishes' THEN 'favorite food'
    WHEN 'favorite drink' THEN 'favorite food'
    WHEN 'favorite drinks' THEN 'favorite food'
    WHEN 'favorite dessert' THEN 'favorite food'
    WHEN 'favorite restaurant' THEN 'favorite food'
    WHEN 'favorite restaurants' THEN 'favorite food'
    WHEN 'favorite movie' THEN 'favorite movies'
    WHEN 'favorite movies' THEN 'favorite movies'
    WHEN 'comfort movie' THEN 'favorite movies'
    WHEN 'favorite game' THEN 'favorite games'
    WHEN 'favorite games' THEN 'favorite games'
    WHEN 'comfort game' THEN 'favorite games'
    WHEN 'favorite character' THEN 'favorite characters'
    WHEN 'favorite characters' THEN 'favorite characters'
    WHEN 'favorite aesthetics characters' THEN 'favorite characters'
    WHEN 'needs' THEN 'care needs'
    WHEN 'care needs' THEN 'care needs'
    WHEN 'pet' THEN 'pets'
    WHEN 'pets' THEN 'pets'
    WHEN 'child' THEN 'children'
    WHEN 'children' THEN 'children'
    WHEN 'kid' THEN 'children'
    WHEN 'kids' THEN 'children'
    ELSE public.profile_norm_label(t)
  END
$function$;

-- 2. Accumulator label set — labels that MUST be one row per (subject, canonical).
CREATE OR REPLACE FUNCTION public.profile_is_accumulator_label(p_canonical text)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  SELECT p_canonical IN (
    'project', 'goal', 'financial goal', 'hobby', 'website',
    'social handle', 'skill', 'certification', 'open source contribution',
    'job task', 'affirmation', 'self description',
    'health conditions', 'medical history', 'allergies', 'dislikes',
    'favorite artists', 'favorite food', 'favorite movies', 'favorite games',
    'favorite characters', 'care needs', 'pets', 'children',
    'vrchat setup', 'vrchat avatar creators'
  )
$function$;

-- 3. Replace BEFORE INSERT trigger with accumulator-aware logic.
CREATE OR REPLACE FUNCTION public.profile_entries_dedup_before_insert()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_canonical text;
  v_is_accumulator boolean;
  v_new_tokens text[];
  v_existing record;
  v_existing_tokens text[];
  v_merged_tokens text[];
  v_merged_value text;
BEGIN
  IF NEW.value IS NULL OR btrim(NEW.value) = '' THEN
    RETURN NEW;
  END IF;

  v_canonical := public.profile_canonical_label(NEW.label);
  v_is_accumulator := public.profile_is_accumulator_label(v_canonical);
  v_new_tokens := public.profile_tokenize_value(NEW.value);

  -- ============ ACCUMULATOR BRANCH ============
  -- One row per (user, contact, canonical). Append residual tokens; never insert duplicates.
  IF v_is_accumulator THEN
    SELECT id, label, value INTO v_existing
    FROM public.profile_entries
    WHERE user_id = NEW.user_id
      AND contact_id IS NOT DISTINCT FROM NEW.contact_id
      AND public.profile_canonical_label(label) = v_canonical
      AND COALESCE(is_pinned, false) = false
    ORDER BY created_at ASC
    LIMIT 1
    FOR UPDATE;

    IF FOUND THEN
      v_existing_tokens := public.profile_tokenize_value(v_existing.value);

      -- Merge, preserving order and de-duplicating by lowercase form.
      SELECT array_agg(tok ORDER BY ord) INTO v_merged_tokens
      FROM (
        SELECT DISTINCT ON (lower(tok)) tok, ord
        FROM (
          SELECT unnest(v_existing_tokens) AS tok, generate_subscripts(v_existing_tokens, 1) AS ord
          UNION ALL
          SELECT unnest(v_new_tokens) AS tok,
                 array_length(v_existing_tokens, 1) + generate_subscripts(v_new_tokens, 1) AS ord
        ) all_tokens
        WHERE tok IS NOT NULL AND btrim(tok) <> ''
        ORDER BY lower(tok), ord
      ) deduped;

      IF v_merged_tokens IS NULL OR array_length(v_merged_tokens, 1) IS NULL THEN
        RETURN NULL;
      END IF;

      v_merged_value := array_to_string(v_merged_tokens, ', ');

      -- No genuine change → drop the insert.
      IF public.profile_norm_value(v_merged_value) = public.profile_norm_value(v_existing.value) THEN
        RETURN NULL;
      END IF;

      UPDATE public.profile_entries
         SET value = v_merged_value,
             updated_at = now(),
             linked_note_id = COALESCE(NEW.linked_note_id, linked_note_id)
       WHERE id = v_existing.id;

      RETURN NULL;  -- suppress the INSERT
    END IF;

    -- No existing row → let the INSERT proceed (first token gets its own row).
    RETURN NEW;
  END IF;

  -- ============ NON-ACCUMULATOR BRANCH (existing behavior) ============
  DECLARE
    v_existing2 record;
    v_existing2_tokens text[];
  BEGIN
    FOR v_existing2 IN
      SELECT id, label, value
      FROM public.profile_entries
      WHERE user_id = NEW.user_id
        AND contact_id IS NOT DISTINCT FROM NEW.contact_id
        AND public.profile_canonical_label(label) = v_canonical
        AND COALESCE(is_pinned, false) = false
      FOR UPDATE
    LOOP
      v_existing2_tokens := public.profile_tokenize_value(v_existing2.value);

      IF public.profile_norm_value(v_existing2.value) = public.profile_norm_value(NEW.value) THEN
        RETURN NULL;  -- exact duplicate
      END IF;

      IF array_length(v_new_tokens, 1) IS NOT NULL
         AND v_new_tokens <@ v_existing2_tokens
         AND array_length(v_new_tokens, 1) < array_length(v_existing2_tokens, 1) THEN
        RETURN NULL;  -- subset, skip
      END IF;

      IF array_length(v_existing2_tokens, 1) IS NOT NULL
         AND v_existing2_tokens <@ v_new_tokens
         AND array_length(v_existing2_tokens, 1) < array_length(v_new_tokens, 1) THEN
        UPDATE public.profile_entries
           SET value = NEW.value,
               updated_at = now(),
               linked_note_id = COALESCE(NEW.linked_note_id, linked_note_id)
         WHERE id = v_existing2.id;
        RETURN NULL;  -- superset, fold in place
      END IF;
    END LOOP;
  END;

  RETURN NEW;
END;
$function$;

-- 4. One-time backfill: collapse every existing accumulator cluster across all users.
CREATE OR REPLACE FUNCTION public.backfill_accumulator_profile_entries()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_cluster record;
  v_keeper_id uuid;
  v_all_tokens text[];
  v_merged_tokens text[];
  v_merged_value text;
  v_deleted int := 0;
  v_collapsed int := 0;
BEGIN
  FOR v_cluster IN
    SELECT user_id, contact_id, public.profile_canonical_label(label) AS canonical,
           array_agg(id ORDER BY created_at ASC) AS ids,
           array_agg(value ORDER BY created_at ASC) AS values
      FROM public.profile_entries
     WHERE COALESCE(is_pinned, false) = false
     GROUP BY user_id, contact_id, public.profile_canonical_label(label)
     HAVING count(*) > 1
        AND public.profile_is_accumulator_label(public.profile_canonical_label(label))
  LOOP
    v_keeper_id := v_cluster.ids[1];

    -- Union all tokens across the cluster, de-dup by lowercase, preserve first-seen order.
    SELECT array_agg(tok) INTO v_all_tokens
    FROM (
      SELECT unnest(public.profile_tokenize_value(v)) AS tok
      FROM unnest(v_cluster.values) AS v
    ) t;

    SELECT array_agg(tok ORDER BY ord) INTO v_merged_tokens
    FROM (
      SELECT DISTINCT ON (lower(tok)) tok, ord
      FROM (SELECT unnest(v_all_tokens) AS tok, generate_subscripts(v_all_tokens, 1) AS ord) x
      WHERE tok IS NOT NULL AND btrim(tok) <> ''
      ORDER BY lower(tok), ord
    ) d;

    IF v_merged_tokens IS NULL OR array_length(v_merged_tokens, 1) IS NULL THEN
      CONTINUE;
    END IF;

    v_merged_value := array_to_string(v_merged_tokens, ', ');

    -- Update the keeper row.
    UPDATE public.profile_entries
       SET value = v_merged_value,
           updated_at = now()
     WHERE id = v_keeper_id;

    -- Delete the redundant rows.
    DELETE FROM public.profile_entries
     WHERE id = ANY(v_cluster.ids[2:array_length(v_cluster.ids, 1)]);

    GET DIAGNOSTICS v_deleted = ROW_COUNT;
    v_collapsed := v_collapsed + v_deleted;
  END LOOP;

  RETURN jsonb_build_object('rows_collapsed', v_collapsed);
END;
$function$;

-- 5. Run the backfill immediately as part of the migration.
SELECT public.backfill_accumulator_profile_entries();
